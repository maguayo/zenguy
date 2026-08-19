import { FakeApiKeyRepo, FakeUserRepo } from "../../test/fakes/repos";
import { OWNER, storedApiKey, WORKSPACE } from "../../test/fixtures/api_keys";
import { ListApiKeys } from "./list_api_keys";

describe("ListApiKeys", () => {
  it("lists active keys newest first with creator refs, excluding revoked", async () => {
    const apiKeys = new FakeApiKeyRepo();
    const users = new FakeUserRepo();
    await users.insert(OWNER);
    await apiKeys.insert(
      storedApiKey({ id: "ak_old", keyHash: "hash-old", createdAt: 100 }),
    );
    await apiKeys.insert(
      storedApiKey({
        id: "ak_new",
        keyHash: "hash-new",
        createdAt: 200,
        createdBy: "usr_deleted",
        lastUsedAt: 250,
      }),
    );
    await apiKeys.insert(
      storedApiKey({
        id: "ak_revoked",
        keyHash: "hash-revoked",
        createdAt: 300,
        revokedAt: 400,
      }),
    );

    const result = await new ListApiKeys(apiKeys, users).execute({
      workspaceId: WORKSPACE.id,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "ak_new",
        createdBy: null,
        lastUsedAt: 250,
      }),
      expect.objectContaining({
        id: "ak_old",
        createdBy: { userId: OWNER.id, name: OWNER.name },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("hash");
  });

  it("ignores keys from other workspaces", async () => {
    const apiKeys = new FakeApiKeyRepo();
    await apiKeys.insert(
      storedApiKey({ id: "ak_other", keyHash: "hash-x", workspaceId: "ws_other" }),
    );
    const result = await new ListApiKeys(apiKeys, new FakeUserRepo()).execute({
      workspaceId: WORKSPACE.id,
    });
    expect(result).toEqual([]);
  });
});
