import { WriteAudit } from "../audit/write_audit";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import { FakeApiKeyRepo, FakeAuditRepo } from "../../test/fakes/repos";
import {
  OWNER,
  storedApiKey,
  WORKSPACE,
} from "../../test/fixtures/api_keys";
import { RevokeApiKey } from "./revoke_api_key";

function build() {
  const apiKeys = new FakeApiKeyRepo();
  const audits = new FakeAuditRepo();
  const clock = new FixedClock(1_700_000_000_000);
  const useCase = new RevokeApiKey(
    apiKeys,
    new WriteAudit({ audits, clock, ids: new FakeIds() }),
    clock,
  );
  return { apiKeys, audits, clock, useCase };
}

function input(overrides: Partial<{ apiKeyId: string; actorRole: "OWNER" | "ADMIN" | "MEMBER"; workspaceId: string }> = {}) {
  return {
    workspaceId: overrides.workspaceId ?? WORKSPACE.id,
    apiKeyId: overrides.apiKeyId ?? "ak_stored_1",
    actor: OWNER,
    actorRole: overrides.actorRole ?? ("OWNER" as const),
    ip: "203.0.113.5",
  };
}

describe("RevokeApiKey", () => {
  it("revokes the key and audits it", async () => {
    const { apiKeys, audits, clock, useCase } = build();
    await apiKeys.insert(storedApiKey());

    await useCase.execute(input());

    expect(apiKeys.apiKeys.get("ak_stored_1")?.revokedAt).toBe(clock.now());
    expect([...audits.entries.values()][0]).toMatchObject({
      workspaceId: WORKSPACE.id,
      actorUserId: OWNER.id,
      action: "api_key.revoked",
      resourceType: "api_key",
      resourceId: "ak_stored_1",
    });
  });

  it("is idempotent for an already revoked key", async () => {
    const { apiKeys, audits, useCase } = build();
    await apiKeys.insert(storedApiKey({ revokedAt: 500 }));

    await useCase.execute(input());

    expect(apiKeys.apiKeys.get("ak_stored_1")?.revokedAt).toBe(500);
    expect(audits.entries.size).toBe(0);
  });

  it("rejects unknown keys and keys from another workspace", async () => {
    const { apiKeys, useCase } = build();
    await apiKeys.insert(storedApiKey());

    await expect(
      useCase.execute(input({ apiKeyId: "ak_missing" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      useCase.execute(input({ workspaceId: "ws_other" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("forbids members", async () => {
    const { apiKeys, useCase } = build();
    await apiKeys.insert(storedApiKey());
    await expect(
      useCase.execute(input({ actorRole: "MEMBER" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
