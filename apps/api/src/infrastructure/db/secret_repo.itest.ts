import type { WorkspaceSecret } from "../../domain/secrets/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1SecretRepo } from "./secret_repo";

const SECRET: WorkspaceSecret = {
  id: "sec_primary",
  workspaceId: "ws_primary",
  key: "SHOP_PASSWORD",
  encryptedValue: "v1:iv:ciphertext",
  encryptionVersion: 1,
  allowedDomains: ["example.com", "*.shop.example.com"],
  description: "Test shop password",
  createdBy: "usr_owner",
  createdAt: 1_000,
  updatedAt: 1_000,
};

describe("D1SecretRepo", () => {
  let repo: D1SecretRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1SecretRepo(testEnv().DB);
  });

  it("round-trips JSON domains and supports value and metadata updates", async () => {
    await repo.insert(SECRET);

    await expect(repo.findByKey("ws_primary", "SHOP_PASSWORD")).resolves.toEqual(
      SECRET,
    );
    await expect(repo.findById("ws_primary", SECRET.id)).resolves.toEqual(
      SECRET,
    );
    await expect(repo.findById("ws_other", SECRET.id)).resolves.toBeNull();
    await expect(repo.list("ws_primary")).resolves.toEqual([SECRET]);
    await expect(
      testEnv()
        .DB.prepare("SELECT allowed_domains FROM workspace_secrets WHERE id = ?")
        .bind(SECRET.id)
        .first(),
    ).resolves.toEqual({
      allowed_domains: JSON.stringify(SECRET.allowedDomains),
    });

    await repo.updateValue(SECRET.id, "v1:new:ciphertext", 2_000);
    await repo.updateMeta(
      SECRET.id,
      { allowedDomains: ["new.example.com"], description: null },
      3_000,
    );
    await expect(repo.findById("ws_primary", SECRET.id)).resolves.toEqual({
      ...SECRET,
      encryptedValue: "v1:new:ciphertext",
      allowedDomains: ["new.example.com"],
      description: null,
      updatedAt: 3_000,
    });

    await repo.delete(SECRET.id);
    await expect(repo.findById("ws_primary", SECRET.id)).resolves.toBeNull();
  });

  it("enforces key uniqueness per workspace but permits another workspace", async () => {
    await repo.insert(SECRET);

    await expect(
      repo.insert({ ...SECRET, id: "sec_duplicate" }),
    ).rejects.toThrow();
    const otherWorkspace = {
      ...SECRET,
      id: "sec_other_workspace",
      workspaceId: "ws_other",
    };
    await expect(repo.insert(otherWorkspace)).resolves.toBeUndefined();
    await expect(
      repo.getManyByKeys("ws_primary", ["SHOP_PASSWORD", "MISSING_KEY"]),
    ).resolves.toEqual([SECRET]);
    await expect(
      repo.getManyByKeys("ws_other", ["SHOP_PASSWORD"]),
    ).resolves.toEqual([otherWorkspace]);
    await expect(repo.getManyByKeys("ws_primary", [])).resolves.toEqual([]);
  });
});
