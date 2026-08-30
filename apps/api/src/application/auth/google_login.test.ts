import { verifyAccessToken } from "../../infrastructure/auth/jwt";
import { sha256Hex } from "../../shared/crypto";
import { FakeTrackEvent } from "../../test/fakes/activity";
import {
  authTestDependencies,
  TEST_NOW,
  testUser,
} from "../../test/fakes/auth";
import { FakeOAuthIdentityRepo } from "../../test/fakes/repos";
import { GoogleLogin } from "./google_login";

function googleLoginDependencies() {
  return {
    ...authTestDependencies(),
    oauthIdentities: new FakeOAuthIdentityRepo(),
  };
}

describe("GoogleLogin", () => {
  it("signs in the user selected by an existing stable Google subject", async () => {
    const track = new FakeTrackEvent();
    const dependencies = { ...googleLoginDependencies(), track };
    const linkedUser = testUser({ emailVerifiedAt: TEST_NOW - 1 });
    const claimEmailOwner = testUser({
      id: "usr_claim_email_owner",
      email: "new-google-email@example.com",
      emailVerifiedAt: TEST_NOW - 1,
    });
    await dependencies.users.insert(linkedUser);
    await dependencies.users.insert(claimEmailOwner);
    await dependencies.oauthIdentities.insertIfAbsent({
      provider: "google",
      subject: "google-subject-stable",
      userId: linkedUser.id,
      emailAtLink: linkedUser.email,
      createdAt: TEST_NOW - 100,
      updatedAt: TEST_NOW - 100,
    });

    const session = await new GoogleLogin(dependencies).execute({
      subject: "google-subject-stable",
      email: claimEmailOwner.email,
      name: "Renamed at Google",
      hostedDomain: null,
      client: "app",
    });

    expect(session.user).toEqual(linkedUser);
    await expect(
      verifyAccessToken(dependencies.config, session.accessToken),
    ).resolves.toMatchObject({ sub: linkedUser.id });
    await expect(
      dependencies.refreshTokens.findByHash(
        await sha256Hex(session.refreshTokenPlain),
      ),
    ).resolves.toMatchObject({ userId: linkedUser.id, revokedAt: null });
    expect(track.calls).toEqual([
      {
        type: "user.logged_in",
        userId: linkedUser.id,
        source: "app",
        properties: { provider: "google" },
      },
    ]);
  });

  it("links a Google subject only to an existing verified user", async () => {
    const dependencies = googleLoginDependencies();
    const user = testUser({
      email: "alice@example.com",
      emailVerifiedAt: TEST_NOW - 1,
    });
    await dependencies.users.insert(user);

    const session = await new GoogleLogin(dependencies).execute({
      subject: "google-subject-first-link",
      email: " ALICE@EXAMPLE.COM ",
      name: "Alice from Google",
      hostedDomain: "example.com",
      client: "web",
    });

    expect(session.user).toEqual(user);
    await expect(
      dependencies.oauthIdentities.findByProviderSubject(
        "google",
        "google-subject-first-link",
      ),
    ).resolves.toEqual({
      provider: "google",
      subject: "google-subject-first-link",
      userId: user.id,
      emailAtLink: "alice@example.com",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    });
    expect(dependencies.users.users.size).toBe(1);
    expect(dependencies.refreshTokens.tokens.size).toBe(1);
  });

  it.each(["gmail.com", "googlemail.com"])(
    "links an authoritative %s address without a Workspace claim",
    async (domain) => {
      const dependencies = googleLoginDependencies();
      const user = testUser({
        email: `alice@${domain}`,
        emailVerifiedAt: TEST_NOW - 1,
      });
      await dependencies.users.insert(user);

      await expect(
        new GoogleLogin(dependencies).execute({
          subject: "google-subject-gmail",
          email: user.email,
          name: user.name,
          hostedDomain: null,
          client: "web",
        }),
      ).resolves.toMatchObject({ user });
    },
  );

  it("does not auto-link a third-party address that Google does not control", async () => {
    const dependencies = googleLoginDependencies();
    const user = testUser({
      email: "alice@example.com",
      emailVerifiedAt: TEST_NOW - 1,
    });
    await dependencies.users.insert(user);

    await expect(
      new GoogleLogin(dependencies).execute({
        subject: "google-subject-third-party",
        email: user.email,
        name: user.name,
        hostedDomain: null,
        client: "web",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(dependencies.oauthIdentities.identities.size).toBe(0);
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
  });

  it.each([
    { label: "unknown", user: null },
    {
      label: "unverified",
      user: testUser({ emailVerifiedAt: null }),
    },
  ])("rejects an $label email without linking or opening a session", async ({ user }) => {
    const track = new FakeTrackEvent();
    const dependencies = { ...googleLoginDependencies(), track };
    if (user !== null) await dependencies.users.insert(user);

    await expect(
      new GoogleLogin(dependencies).execute({
        subject: "google-subject-rejected",
        email: user?.email ?? "unknown@example.com",
        name: "Google User",
        hostedDomain: "example.com",
        client: "web",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "A verified Zenguy account is required before Google can be linked",
    });

    expect(dependencies.oauthIdentities.identities.size).toBe(0);
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
    expect(track.calls).toEqual([]);
  });

  it("accepts the same-user winner when the first link loses a race", async () => {
    const dependencies = googleLoginDependencies();
    const user = testUser({ emailVerifiedAt: TEST_NOW - 1 });
    await dependencies.users.insert(user);
    const insert =
      dependencies.oauthIdentities.insertIfAbsent.bind(
        dependencies.oauthIdentities,
      );
    vi.spyOn(
      dependencies.oauthIdentities,
      "insertIfAbsent",
    ).mockImplementationOnce(async (identity) => {
      expect(await insert(identity)).toBe(true);
      return false;
    });

    await expect(
      new GoogleLogin(dependencies).execute({
        subject: "google-subject-raced",
        email: user.email,
        name: user.name,
        hostedDomain: "example.com",
        client: "web",
      }),
    ).resolves.toMatchObject({ user });

    expect(dependencies.oauthIdentities.identities.size).toBe(1);
    expect(dependencies.refreshTokens.tokens.size).toBe(1);
  });

  it("rejects a race won by a different user without opening a session", async () => {
    const dependencies = googleLoginDependencies();
    const claimant = testUser({ emailVerifiedAt: TEST_NOW - 1 });
    const raceWinner = testUser({
      id: "usr_race_winner",
      email: "winner@example.com",
      emailVerifiedAt: TEST_NOW - 1,
    });
    await dependencies.users.insert(claimant);
    await dependencies.users.insert(raceWinner);
    const insert =
      dependencies.oauthIdentities.insertIfAbsent.bind(
        dependencies.oauthIdentities,
      );
    vi.spyOn(
      dependencies.oauthIdentities,
      "insertIfAbsent",
    ).mockImplementationOnce(async (identity) => {
      expect(
        await insert({
          ...identity,
          userId: raceWinner.id,
          emailAtLink: raceWinner.email,
        }),
      ).toBe(true);
      return false;
    });

    await expect(
      new GoogleLogin(dependencies).execute({
        subject: "google-subject-contended",
        email: claimant.email,
        name: claimant.name,
        hostedDomain: "example.com",
        client: "web",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This Google account is already linked",
    });

    await expect(
      dependencies.oauthIdentities.findByProviderSubject(
        "google",
        "google-subject-contended",
      ),
    ).resolves.toMatchObject({ userId: raceWinner.id });
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
  });

  it("rejects a second Google subject for an already-linked user", async () => {
    const dependencies = googleLoginDependencies();
    const user = testUser({ emailVerifiedAt: TEST_NOW - 1 });
    await dependencies.users.insert(user);
    await dependencies.oauthIdentities.insertIfAbsent({
      provider: "google",
      subject: "google-subject-original",
      userId: user.id,
      emailAtLink: user.email,
      createdAt: TEST_NOW - 1,
      updatedAt: TEST_NOW - 1,
    });

    await expect(
      new GoogleLogin(dependencies).execute({
        subject: "google-subject-second",
        email: user.email,
        name: user.name,
        hostedDomain: "example.com",
        client: "web",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(dependencies.oauthIdentities.identities.size).toBe(1);
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
  });
});
