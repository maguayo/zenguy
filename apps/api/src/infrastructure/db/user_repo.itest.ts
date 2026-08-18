import type { User } from "../../domain/users/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1UserRepo } from "./user_repo";

const USER: User = {
  id: "usr_alice",
  name: "Alice",
  email: "alice@example.com",
  passwordHash: "password-hash",
  emailVerifiedAt: null,
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
      updatedAt: 4_000,
    });
  });
});
