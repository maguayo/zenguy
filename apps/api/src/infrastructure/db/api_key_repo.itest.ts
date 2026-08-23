import type { WorkspaceApiKey } from "../../domain/api_keys/types";
import { DEFAULT_API_KEY_SCOPES } from "../../domain/api_keys/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1ApiKeyRepo } from "./api_key_repo";

const API_KEY: WorkspaceApiKey = {
  id: "ak_primary",
  workspaceId: "ws_primary",
  name: "Status dashboard",
  keyPrefix: "zgk_abcd1234",
  keyHash: "hash-primary",
  scopes: [...DEFAULT_API_KEY_SCOPES],
  expiresAt: 10_000,
  createdBy: "usr_owner",
  createdAt: 1_000,
  lastUsedAt: null,
  revokedAt: null,
};

describe("D1ApiKeyRepo", () => {
  let repo: D1ApiKeyRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1ApiKeyRepo(testEnv().DB);
  });

  it("round-trips keys and scopes lookups to the workspace", async () => {
    await repo.insert(API_KEY);

    await expect(repo.findById("ws_primary", API_KEY.id)).resolves.toEqual(
      API_KEY,
    );
    await expect(repo.findById("ws_other", API_KEY.id)).resolves.toBeNull();
    await expect(repo.findByHash("hash-primary")).resolves.toEqual(API_KEY);
    await expect(repo.findByHash("hash-unknown")).resolves.toBeNull();
  });

  it("rejects duplicate key hashes", async () => {
    await repo.insert(API_KEY);
    await expect(
      repo.insert({ ...API_KEY, id: "ak_other" }),
    ).rejects.toThrow();
  });

  it("lists newest first and counts only active keys per workspace", async () => {
    await repo.insert(API_KEY);
    await repo.insert({
      ...API_KEY,
      id: "ak_newer",
      keyHash: "hash-newer",
      createdAt: 2_000,
    });
    await repo.insert({
      ...API_KEY,
      id: "ak_revoked",
      keyHash: "hash-revoked",
      createdAt: 3_000,
      revokedAt: 3_500,
    });
    await repo.insert({
      ...API_KEY,
      id: "ak_foreign",
      workspaceId: "ws_other",
      keyHash: "hash-foreign",
    });

    await expect(repo.list("ws_primary")).resolves.toMatchObject([
      { id: "ak_revoked" },
      { id: "ak_newer" },
      { id: "ak_primary" },
    ]);
    await expect(repo.countActive("ws_primary", 4_000)).resolves.toBe(2);
    await expect(repo.countActive("ws_other", 4_000)).resolves.toBe(1);
    await expect(repo.countActive("ws_empty", 4_000)).resolves.toBe(0);
    await expect(repo.countActive("ws_primary", 10_000)).resolves.toBe(0);
  });

  it("revokes once and keeps the original revocation timestamp", async () => {
    await repo.insert(API_KEY);

    await repo.revoke(API_KEY.id, 5_000);
    await expect(repo.findById("ws_primary", API_KEY.id)).resolves.toMatchObject(
      { revokedAt: 5_000 },
    );

    await repo.revoke(API_KEY.id, 9_000);
    await expect(repo.findById("ws_primary", API_KEY.id)).resolves.toMatchObject(
      { revokedAt: 5_000 },
    );
  });

  it("updates last_used_at", async () => {
    await repo.insert(API_KEY);
    await repo.touchLastUsed(API_KEY.id, 4_000);
    await expect(repo.findById("ws_primary", API_KEY.id)).resolves.toMatchObject(
      { lastUsedAt: 4_000 },
    );
  });
});
