import { WriteAudit } from "../audit/write_audit";
import { FixedClock } from "../../shared/clock";
import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  MAX_ACTIVE_API_KEYS_PER_WORKSPACE,
} from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeApiKeyRepo,
  FakeAuditRepo,
  FakeSubscriptionRepo,
} from "../../test/fakes/repos";
import { CreateApiKey } from "./create_api_key";
import {
  activeSubscription,
  OWNER,
  storedApiKey,
  WORKSPACE,
} from "../../test/fixtures/api_keys";

function build() {
  const apiKeys = new FakeApiKeyRepo();
  const subscriptions = new FakeSubscriptionRepo();
  const audits = new FakeAuditRepo();
  const clock = new FixedClock(1_700_000_000_000);
  const useCase = new CreateApiKey(
    apiKeys,
    subscriptions,
    new WriteAudit({ audits, clock, ids: new FakeIds() }),
    clock,
    new FakeIds(),
  );
  return { apiKeys, subscriptions, audits, clock, useCase };
}

function input(overrides: Partial<{ name: string; actorRole: "OWNER" | "ADMIN" | "MEMBER" }> = {}) {
  return {
    workspaceId: WORKSPACE.id,
    actor: OWNER,
    actorRole: overrides.actorRole ?? ("OWNER" as const),
    name: overrides.name ?? "Status dashboard",
    ip: "203.0.113.5",
  };
}

describe("CreateApiKey", () => {
  it("returns the plaintext key once and stores only its hash", async () => {
    const { apiKeys, subscriptions, audits, clock, useCase } = build();
    await subscriptions.upsertByWorkspace(activeSubscription());

    const result = await useCase.execute(input({ name: "  Status dashboard  " }));

    expect(result.key).toMatch(/^zgk_[A-Za-z0-9_-]{43}$/);
    expect(result.apiKey).toMatchObject({
      name: "Status dashboard",
      keyPrefix: result.key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
      createdBy: { userId: OWNER.id, name: OWNER.name },
      createdAt: clock.now(),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(result.apiKey)).not.toContain(result.key);

    const stored = [...apiKeys.apiKeys.values()][0];
    expect(stored?.keyHash).toBe(await sha256Hex(result.key));
    expect(JSON.stringify(stored)).not.toContain(result.key);

    const entry = [...audits.entries.values()][0];
    expect(entry).toMatchObject({
      workspaceId: WORKSPACE.id,
      actorUserId: OWNER.id,
      action: "api_key.created",
      resourceType: "api_key",
      resourceId: stored?.id,
    });
    expect(entry?.metadataJson).not.toContain(result.key);
  });

  it("generates a distinct key on every call", async () => {
    const { subscriptions, useCase } = build();
    await subscriptions.upsertByWorkspace(activeSubscription());

    const first = await useCase.execute(input({ name: "First" }));
    const second = await useCase.execute(input({ name: "Second" }));
    expect(first.key).not.toBe(second.key);
  });

  it("forbids members", async () => {
    const { useCase } = build();
    await expect(
      useCase.execute(input({ actorRole: "MEMBER" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires an active subscription", async () => {
    const { subscriptions, useCase } = build();
    await subscriptions.upsertByWorkspace({
      ...activeSubscription(),
      status: "CANCELED",
    });
    await expect(useCase.execute(input())).rejects.toMatchObject({
      code: "BILLING_REQUIRED",
    });
  });

  it("rejects blank and overlong names", async () => {
    const { subscriptions, useCase } = build();
    await subscriptions.upsertByWorkspace(activeSubscription());
    for (const name of ["   ", "x".repeat(81)]) {
      const error = await useCase.execute(input({ name })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("VALIDATION_ERROR");
      expect((error as AppError).details).toEqual([
        expect.objectContaining({ field: "name" }),
      ]);
    }
  });

  it("caps active keys per workspace, ignoring revoked ones", async () => {
    const { apiKeys, subscriptions, useCase } = build();
    await subscriptions.upsertByWorkspace(activeSubscription());
    for (let index = 0; index < MAX_ACTIVE_API_KEYS_PER_WORKSPACE; index += 1) {
      await apiKeys.insert(
        storedApiKey({
          id: `ak_seed_${index}`,
          keyHash: `seed-hash-${index}`,
          revokedAt: index === 0 ? 999 : null,
        }),
      );
    }

    // 19 active + 1 revoked: still under the cap.
    await useCase.execute(input({ name: "Fits" }));
    await expect(
      useCase.execute(input({ name: "Overflow" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
