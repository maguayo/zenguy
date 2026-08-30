import type { OAuthIdentity } from "../../domain/users/oauth_identity";
import type { User } from "../../domain/users/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1OAuthIdentityRepo } from "./oauth_identity_repo";
import { D1UserRepo } from "./user_repo";

const USER: User = {
  id: "usr_oauth_alice",
  name: "Alice",
  email: "alice@example.com",
  passwordHash: "password-hash",
  emailVerifiedAt: 900,
  authVersion: 1,
  createdAt: 800,
  updatedAt: 900,
};

const OTHER_USER: User = {
  ...USER,
  id: "usr_oauth_bob",
  name: "Bob",
  email: "bob@example.com",
};

const IDENTITY: OAuthIdentity = {
  provider: "google",
  subject: "google-subject-alice",
  userId: USER.id,
  emailAtLink: USER.email,
  createdAt: 1_000,
  updatedAt: 1_000,
};

describe("D1OAuthIdentityRepo", () => {
  let repo: D1OAuthIdentityRepo;
  let users: D1UserRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1OAuthIdentityRepo(testEnv().DB);
    users = new D1UserRepo(testEnv().DB);
    await users.insert(USER);
    await users.insert(OTHER_USER);
  });

  it("inserts and finds an identity by provider and stable subject", async () => {
    await expect(repo.insertIfAbsent(IDENTITY)).resolves.toBe(true);

    await expect(
      repo.findByProviderSubject("google", IDENTITY.subject),
    ).resolves.toEqual(IDENTITY);
    await expect(
      repo.findByProviderSubject("google", "google-subject-missing"),
    ).resolves.toBeNull();
  });

  it("enforces unique provider subjects and one identity per provider and user", async () => {
    await expect(repo.insertIfAbsent(IDENTITY)).resolves.toBe(true);

    await expect(
      repo.insertIfAbsent({
        ...IDENTITY,
        userId: OTHER_USER.id,
        emailAtLink: OTHER_USER.email,
      }),
    ).resolves.toBe(false);
    await expect(
      repo.insertIfAbsent({
        ...IDENTITY,
        subject: "google-subject-alice-second",
      }),
    ).resolves.toBe(false);
    await expect(
      repo.findByProviderSubject("google", IDENTITY.subject),
    ).resolves.toEqual(IDENTITY);
  });

  it("allows exactly one winner when concurrent inserts contend for a user", async () => {
    const candidates: OAuthIdentity[] = [
      IDENTITY,
      { ...IDENTITY, subject: "google-subject-alice-racer" },
    ];

    const results = await Promise.all(
      candidates.map((identity) => repo.insertIfAbsent(identity)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const rows = await Promise.all(
      candidates.map((identity) =>
        repo.findByProviderSubject("google", identity.subject),
      ),
    );
    expect(rows.filter((identity) => identity !== null)).toHaveLength(1);
  });

  it("rejects an identity whose user does not exist", async () => {
    await expect(
      repo.insertIfAbsent({
        ...IDENTITY,
        subject: "google-subject-orphan",
        userId: "usr_missing",
      }),
    ).rejects.toThrow();
  });

  it("deletes linked identities when their user is deleted", async () => {
    await repo.insertIfAbsent(IDENTITY);

    await testEnv()
      .DB.prepare("DELETE FROM users WHERE id = ?")
      .bind(USER.id)
      .run();

    await expect(
      repo.findByProviderSubject("google", IDENTITY.subject),
    ).resolves.toBeNull();
  });
});
