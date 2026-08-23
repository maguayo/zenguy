import { FakeSecretRepo, FakeUserRepo } from "../../test/fakes/repos";
import { ListSecrets } from "./list_secrets";

describe("ListSecrets", () => {
  it("keyset-paginates and batches creator reads", async () => {
    const secrets = new FakeSecretRepo();
    const users = new FakeUserRepo();
    users.users.set("usr_creator", {
      id: "usr_creator",
      name: "Creator",
      email: "creator@example.com",
      passwordHash: "hash",
      emailVerifiedAt: 1,
      authVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    for (const [id, createdAt] of [
      ["sec_old", 1],
      ["sec_middle", 2],
      ["sec_new", 3],
    ] as const) {
      await secrets.insert({
        id,
        workspaceId: "ws_1",
        key: id.toUpperCase(),
        encryptedValue: "encrypted",
        encryptionVersion: 2,
        allowedDomains: ["example.com"],
        description: null,
        createdBy: "usr_creator",
        createdAt,
        updatedAt: createdAt,
      });
    }
    const findOne = vi.spyOn(users, "findById");
    const findMany = vi.spyOn(users, "findByIds");
    const useCase = new ListSecrets(secrets, users);

    const first = await useCase.execute({ workspaceId: "ws_1", limit: 2 });
    expect(first.secrets.map(({ id }) => id)).toEqual(["sec_new", "sec_middle"]);
    expect(first.nextCursor).not.toBeNull();
    expect(findOne).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(first.secrets[0]?.createdBy).toEqual({
      userId: "usr_creator",
      name: "Creator",
    });

    const second = await useCase.execute({
      workspaceId: "ws_1",
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.secrets.map(({ id }) => id)).toEqual(["sec_old"]);
    expect(second.nextCursor).toBeNull();
  });
});
