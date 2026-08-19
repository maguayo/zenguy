import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AuditEntry, Member } from "../../api/types";
import {
  auditColumns,
  filterWorkspaceTimezones,
  prettyAuditMetadata,
  transferCandidates,
  workspaceSettingsSchema,
} from "./SettingsPage";

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

describe("workspace settings page", () => {
  it("validates names and filters timezone choices like onboarding", () => {
    expect(workspaceSettingsSchema.safeParse({ name: "Acme", timezone: "UTC" }).success).toBe(true);
    expect(workspaceSettingsSchema.safeParse({ name: "", timezone: "" }).success).toBe(false);
    expect(workspaceSettingsSchema.safeParse({ name: "x".repeat(81), timezone: "UTC" }).success).toBe(false);
    expect(
      filterWorkspaceTimezones(["Europe/Madrid", "America/New_York", "Asia/Tokyo"], "MADRID"),
    ).toEqual(["Europe/Madrid"]);
  });

  it("offers every existing member except the current owner", () => {
    const members = [member("owner", "OWNER"), member("admin", "ADMIN"), member("member", "MEMBER")];
    expect(transferCandidates(members, "owner").map((candidate) => candidate.userId)).toEqual([
      "admin",
      "member",
    ]);
  });

  it("renders all audit fields and pretty-prints metadata", () => {
    const columns = auditColumns("UTC", (id) => <span>copy {id}</span>);
    expect(columns.map((column) => column.key)).toEqual([
      "time",
      "actor",
      "action",
      "resource",
      "details",
    ]);
    const html = renderToStaticMarkup(
      <>{columns.map((column) => <div key={column.key}>{column.render(auditEntry)}</div>)}</>,
    );
    expect(html).toContain("19 Aug 2026, 10:00");
    expect(html).toContain("System");
    expect(html).toContain("secret.created");
    expect(html).toContain("secret · secret_1");
    expect(html).toContain("copy secret_1");
    expect(prettyAuditMetadata(auditEntry.metadata ?? {})).toContain('\n  "nested": {');
  });
});
