import { sha256Hex } from "../../shared/crypto";
import { FakeTrackEvent } from "../../test/fakes/activity";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { Logout } from "./logout";

describe("Logout", () => {
  it("revokes a known refresh token", async () => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(testUser());
    await dependencies.refreshTokens.insert({
      id: "rt_known",
      userId: "usr_alice",
      tokenHash: await sha256Hex("known-plain"),
      expiresAt: dependencies.clock.now() + 1_000,
      revokedAt: null,
      replacedById: null,
      createdAt: dependencies.clock.now(),
    });

    await expect(
      new Logout(dependencies).execute({
        refreshTokenPlain: "known-plain",
        client: "web",
      }),
    ).resolves.toEqual({ loggedOut: true });
    expect(dependencies.refreshTokens.tokens.get("rt_known")?.revokedAt).toBe(
      dependencies.clock.now(),
    );
    await expect(dependencies.users.findById("usr_alice")).resolves.toMatchObject({
      authVersion: 2,
    });
    expect(dependencies.sessionSecurity.revokedAdminUsers).toContain("usr_alice");
    expect(dependencies.sessionSecurity.disabledPushUsers).toContain("usr_alice");
  });

  it("always succeeds for missing or unknown tokens", async () => {
    const dependencies = authTestDependencies();
    const useCase = new Logout(dependencies);

    await expect(
      useCase.execute({ refreshTokenPlain: null, client: "web" }),
    ).resolves.toEqual({ loggedOut: true });
    await expect(
      useCase.execute({ refreshTokenPlain: "unknown", client: "web" }),
    ).resolves.toEqual({ loggedOut: true });
  });

  it("records user.logged_out for a known refresh token", async () => {
    const track = new FakeTrackEvent();
    const dependencies = { ...authTestDependencies(), track };
    await dependencies.users.insert(testUser());
    const token = {
      id: "rt_known",
      userId: "usr_alice",
      tokenHash: await sha256Hex("known-plain"),
      expiresAt: dependencies.clock.now() + 1_000,
      revokedAt: null,
      replacedById: null,
      createdAt: dependencies.clock.now(),
    };
    await dependencies.refreshTokens.insert(token);

    await new Logout(dependencies).execute({
      refreshTokenPlain: "known-plain",
      client: "web",
    });

    expect(track.calls).toEqual([
      { type: "user.logged_out", userId: token.userId, source: "web" },
    ]);
  });

  it("records nothing without a refresh token", async () => {
    const track = new FakeTrackEvent();
    const logout = new Logout({ ...authTestDependencies(), track });

    await logout.execute({ refreshTokenPlain: null, client: "web" });

    expect(track.calls).toEqual([]);
  });
});
