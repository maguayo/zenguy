import { describe, expect, it } from "@jest/globals";

import type { AuditEntry, Member } from "@/api/types";
import {
  auditActorName,
  auditResourceLabel,
  canConfirmDeletion,
  prettyAuditMetadata,
  transferCandidates,
  workspaceSettingsSchema,
} from "./settings";

const member = (userId: string, role: Member["role"]): Member => ({
  email: `${userId}@example.com`,
  joinedAt: "2026-08-19T10:00:00.000Z",
  name: userId,
  role,
  userId,
});

const auditEntry: AuditEntry = {
  action: "secret.created",
  actor: null,
  createdAt: "2026-08-19T10:00:00.000Z",
  id: "audit_1",
  ip: "203.0.113.1",
  metadata: { key: "DEMO_TOKEN", nested: { safe: true } },
  resourceId: "secret_1",
  resourceType: "secret",
};

describe("workspace settings", () => {
  it("validates names like the web settings page", () => {
    expect(workspaceSettingsSchema.safeParse({ name: "Acme", timezone: "UTC" }).success).toBe(true);
    expect(workspaceSettingsSchema.safeParse({ name: "", timezone: "" }).success).toBe(false);
    expect(workspaceSettingsSchema.safeParse({ name: "   ", timezone: "UTC" }).success).toBe(false);
    expect(
      workspaceSettingsSchema.safeParse({ name: "x".repeat(81), timezone: "UTC" }).success,
    ).toBe(false);
    expect(workspaceSettingsSchema.parse({ name: "  Acme  ", timezone: "UTC" })).toEqual({
      name: "Acme",
      timezone: "UTC",
    });
    const result = workspaceSettingsSchema.safeParse({ name: "Acme", timezone: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Choose a timezone.");
  });

  it("offers every existing member except the current owner", () => {
    const members = [member("owner", "OWNER"), member("admin", "ADMIN"), member("member", "MEMBER")];
    expect(transferCandidates(members, "owner").map((candidate) => candidate.userId)).toEqual([
      "admin",
      "member",
    ]);
  });

  it("renders audit actor and resource labels and pretty-prints metadata", () => {
    expect(auditActorName(auditEntry)).toBe("System");
    expect(auditActorName({ ...auditEntry, actor: { name: "Ada", userId: "usr_1" } })).toBe("Ada");
    expect(auditResourceLabel(auditEntry)).toBe("secret · secret_1");
    expect(auditResourceLabel({ ...auditEntry, resourceType: null })).toBe("resource · secret_1");
    expect(auditResourceLabel({ ...auditEntry, resourceId: null })).toBe("secret · —");
    expect(auditResourceLabel({ ...auditEntry, resourceId: null, resourceType: null })).toBeNull();
    expect(prettyAuditMetadata(auditEntry.metadata ?? {})).toContain('\n  "nested": {');
  });

  it("requires the exact workspace name before deleting", () => {
    expect(canConfirmDeletion("Acme", "Acme")).toBe(true);
    expect(canConfirmDeletion("  Acme ", "Acme")).toBe(true);
    expect(canConfirmDeletion("acme", "Acme")).toBe(false);
    expect(canConfirmDeletion("", "Acme")).toBe(false);
  });
});
