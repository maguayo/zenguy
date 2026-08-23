import type { WorkspaceSecret } from "../../domain/secrets/types";
import {
  encryptTestValue,
  freshDb,
  testEnv,
} from "../../test/helpers";
import { D1SecretRepo } from "./secret_repo";

type SecretOverrides = Partial<
  Pick<
    WorkspaceSecret,
    "id" | "workspaceId" | "key" | "createdAt" | "updatedAt"
  >
>;

async function secret(overrides: SecretOverrides = {}): Promise<WorkspaceSecret> {
  const id = overrides.id ?? "sec_primary";
  const workspaceId = overrides.workspaceId ?? "ws_primary";
  return {
    id,
    workspaceId,
    key: overrides.key ?? "SHOP_PASSWORD",
    encryptedValue: await encryptTestValue({
      type: "workspace_secret",
      workspaceId,
      recordId: id,
    }),
    encryptionVersion: 4,
    allowedDomains: ["example.com", "*.shop.example.com"],
    description: "Test shop password",
    createdBy: "usr_owner",
    createdAt: overrides.createdAt ?? 1_000,
    updatedAt: overrides.updatedAt ?? 1_000,
  };
}

describe("D1SecretRepo", () => {
  let repo: D1SecretRepo;
  let primary: WorkspaceSecret;

  beforeEach(async () => {
    await freshDb();
    await testEnv().DB.batch([
      testEnv().DB.prepare(
        `INSERT INTO users
          (id, name, email, password_hash, created_at, updated_at)
         VALUES ('usr_owner', 'Owner', 'owner@secret-repo.test', 'hash', 1, 1)`,
      ),
      testEnv().DB.prepare(
        `INSERT INTO workspaces
          (id, name, slug, timezone, owner_user_id, created_at, updated_at)
         VALUES ('ws_primary', 'Primary', 'secret-repo-primary', 'UTC',
                 'usr_owner', 1, 1),
                ('ws_other', 'Other', 'secret-repo-other', 'UTC',
                 'usr_owner', 1, 1)`,
      ),
    ]);
    repo = new D1SecretRepo(testEnv().DB);
    primary = await secret();
  });

  it("round-trips JSON domains and supports value and metadata updates", async () => {
    await repo.insert(primary);

    await expect(repo.findByKey("ws_primary", "SHOP_PASSWORD")).resolves.toEqual(
      primary,
    );
    await expect(repo.findById("ws_primary", primary.id)).resolves.toEqual(
      primary,
    );
    await expect(repo.findById("ws_other", primary.id)).resolves.toBeNull();
    await expect(repo.list("ws_primary")).resolves.toEqual([primary]);
    await expect(
      testEnv()
        .DB.prepare("SELECT allowed_domains FROM workspace_secrets WHERE id = ?")
        .bind(primary.id)
        .first(),
    ).resolves.toEqual({
      allowed_domains: JSON.stringify(primary.allowedDomains),
    });

    const replacement = await encryptTestValue(
      {
        type: "workspace_secret",
        workspaceId: primary.workspaceId,
        recordId: primary.id,
      },
      "synthetic-replacement-value",
    );
    await repo.updateValue(primary.id, replacement, 4, 2_000);
    await repo.updateMeta(
      primary.id,
      { allowedDomains: ["new.example.com"], description: null },
      3_000,
    );
    await expect(repo.findById("ws_primary", primary.id)).resolves.toEqual({
      ...primary,
      encryptedValue: replacement,
      encryptionVersion: 4,
      allowedDomains: ["new.example.com"],
      description: null,
      updatedAt: 3_000,
    });

    await repo.delete(primary.id);
    await expect(repo.findById("ws_primary", primary.id)).resolves.toBeNull();
  });

  it("keyset-paginates within the workspace", async () => {
    const middle = await secret({
      id: "sec_middle",
      key: "MIDDLE_SECRET",
      createdAt: 2_000,
      updatedAt: 2_000,
    });
    const newest = await secret({
      id: "sec_newest",
      key: "NEWEST_SECRET",
      createdAt: 3_000,
      updatedAt: 3_000,
    });
    const other = await secret({
      id: "sec_other",
      workspaceId: "ws_other",
      createdAt: 4_000,
      updatedAt: 4_000,
    });
    for (const value of [primary, middle, newest, other]) await repo.insert(value);

    await expect(repo.listPage("ws_primary", null, 2)).resolves.toEqual([
      newest,
      middle,
    ]);
    await expect(
      repo.listPage(
        "ws_primary",
        { createdAt: middle.createdAt, id: middle.id },
        2,
      ),
    ).resolves.toEqual([primary]);
  });

  it("enforces key uniqueness per workspace but permits another workspace", async () => {
    await repo.insert(primary);

    await expect(
      repo.insert(await secret({ id: "sec_duplicate" })),
    ).rejects.toThrow();
    const otherWorkspace = await secret({
      id: "sec_other_workspace",
      workspaceId: "ws_other",
    });
    await expect(repo.insert(otherWorkspace)).resolves.toBeUndefined();
    await expect(
      repo.getManyByKeys("ws_primary", ["SHOP_PASSWORD", "MISSING_KEY"]),
    ).resolves.toEqual([primary]);
    await expect(
      repo.getManyByKeys("ws_other", ["SHOP_PASSWORD"]),
    ).resolves.toEqual([otherWorkspace]);
    await expect(repo.getManyByKeys("ws_primary", [])).resolves.toEqual([]);
  });
});
