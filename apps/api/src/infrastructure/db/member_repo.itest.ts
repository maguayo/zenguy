import type { User } from "../../domain/users/types";
import type { WorkspaceMember } from "../../domain/workspaces/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1MemberRepo } from "./member_repo";
import { D1UserRepo } from "./user_repo";

const USERS: User[] = [
  {
    id: "usr_alice",
    name: "Alice",
    email: "alice@example.com",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  {
    id: "usr_bob",
    name: "Bob",
    email: "bob@example.com",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1_001,
    updatedAt: 1_001,
  },
];

function member(userId: string, id: string): WorkspaceMember {
  return {
    id,
    workspaceId: "ws_primary",
    userId,
    role: "MEMBER",
    invitedBy: USERS[0]?.id ?? null,
    joinedAt: 2_000,
  };
}

describe("D1MemberRepo", () => {
  let repo: D1MemberRepo;

  beforeEach(async () => {
    await freshDb();
    const database = testEnv().DB;
    repo = new D1MemberRepo(database);
    const users = new D1UserRepo(database);
    for (const user of USERS) await users.insert(user);
  });

  it("enforces one membership per workspace and user", async () => {
    const first = member(USERS[0]?.id ?? "", "mem_first");
    await repo.insert(first);

    await expect(repo.find(first.workspaceId, first.userId)).resolves.toEqual(
      first,
    );
    await expect(
      repo.insert({ ...first, id: "mem_duplicate" }),
    ).rejects.toThrow();
  });

  it("joins user identity, updates roles, and removes members", async () => {
    const alice = member(USERS[0]?.id ?? "", "mem_alice");
    const bob = member(USERS[1]?.id ?? "", "mem_bob");
    await repo.insert(alice);
    await repo.insert(bob);

    await expect(repo.list("ws_primary")).resolves.toEqual([
      { ...alice, userName: "Alice", userEmail: "alice@example.com" },
      { ...bob, userName: "Bob", userEmail: "bob@example.com" },
    ]);

    await repo.updateRole("ws_primary", bob.userId, "ADMIN");
    await expect(repo.find("ws_primary", bob.userId)).resolves.toMatchObject({
      role: "ADMIN",
    });
    await repo.remove("ws_primary", alice.userId);
    await expect(repo.find("ws_primary", alice.userId)).resolves.toBeNull();
  });
});
