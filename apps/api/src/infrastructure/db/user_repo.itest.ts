import type { User } from "../../domain/users/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1UserRepo } from "./user_repo";

const USER: User = {
  id: "usr_alice",
  name: "Alice",
  email: "alice@example.com",
  passwordHash: "password-hash",
  emailVerifiedAt: null,
  authVersion: 1,
  createdAt: 1_000,
  updatedAt: 1_000,
};

describe("D1UserRepo", () => {
  let repo: D1UserRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1UserRepo(testEnv().DB);
  });

  it("inserts and finds a user by id and case-insensitive email", async () => {
    await repo.insert(USER);

    await expect(repo.findById(USER.id)).resolves.toEqual(USER);
    await expect(repo.findByEmail("ALICE@EXAMPLE.COM")).resolves.toEqual(USER);
    await expect(repo.findById("usr_missing")).resolves.toBeNull();
  });

  it("finds a deduplicated batch of users", async () => {
    const other = {
      ...USER,
      id: "usr_bob",
      name: "Bob",
      email: "bob@example.com",
    };
    await repo.insert(USER);
    await repo.insert(other);

    await expect(
      repo.findByIds([other.id, USER.id, other.id, "usr_missing"]),
    ).resolves.toEqual(expect.arrayContaining([USER, other]));
    await expect(repo.findByIds([])).resolves.toEqual([]);
  });

  it("enforces case-insensitive email uniqueness", async () => {
    await repo.insert(USER);

    await expect(
      repo.insert({
        ...USER,
        id: "usr_other",
        email: "ALICE@EXAMPLE.COM",
      }),
    ).rejects.toThrow();
  });

  it("updates verification, password, name, and updated time", async () => {
    await repo.insert(USER);
    await repo.setEmailVerified(USER.id, 2_000);
    await repo.setPassword(USER.id, "new-hash", 3_000);
    await repo.updateName(USER.id, "Alice Smith", 4_000);

    await expect(repo.findById(USER.id)).resolves.toEqual({
      ...USER,
      name: "Alice Smith",
      passwordHash: "new-hash",
      emailVerifiedAt: 2_000,
      authVersion: 1,
      updatedAt: 4_000,
    });
  });

  it("rehashes a password with compare-and-swap semantics", async () => {
    await repo.insert(USER);

    await expect(
      repo.rehashPasswordIfUnchanged(
        USER.id,
        "stale-hash",
        "must-not-win",
        2_000,
      ),
    ).resolves.toBe(false);
    await expect(repo.findById(USER.id)).resolves.toEqual(USER);

    await expect(
      repo.rehashPasswordIfUnchanged(
        USER.id,
        USER.passwordHash,
        "rehash-v1",
        3_000,
      ),
    ).resolves.toBe(true);
    await expect(repo.findById(USER.id)).resolves.toEqual({
      ...USER,
      passwordHash: "rehash-v1",
      updatedAt: 3_000,
    });
  });
});
