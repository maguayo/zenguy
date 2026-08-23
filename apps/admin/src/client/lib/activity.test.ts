import { describe, expect, it } from "vitest";

import type { ActiveWorkspaceRow, WorkspaceActivitySummary } from "../../shared/types";
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_TYPE_STORAGE_KEY,
  groupActivityTypes,
  joinWorkspaceRows,
  labelForType,
  parseActivityType,
  propertiesSummary,
  shortId,
} from "./activity";

const NOW = 1_800_000_000_000;

function workspace(over: Partial<WorkspaceActivitySummary> = {}): WorkspaceActivitySummary {
  return {
    createdAt: NOW - 86_400_000,
    id: "ws_1",
    lastActiveAt: NOW - 1_000,
    lastAlertSentAt: null,
    lastAppAt: null,
    lastLoginAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastTestCreatedAt: null,
    lastWebAt: null,
    memberCount: 1,
    name: "Acme",
    ownerEmail: null,
    slug: "acme",
    ...over,
  };
}

describe("activity catalog", () => {
  it("carries every event type the API records, in a shape the type filter accepts", () => {
    // The server rejects anything that is not a lowercase `subject.verb`, so a
    // typo here would turn a filter click into a 400.
    expect(ACTIVITY_EVENT_TYPES).toHaveLength(61);
    for (const type of ACTIVITY_EVENT_TYPES) {
      expect(type, type).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
    expect(new Set(ACTIVITY_EVENT_TYPES).size).toBe(ACTIVITY_EVENT_TYPES.length);
    expect(ACTIVITY_EVENT_TYPES).toContain("user.logged_in");
    expect(ACTIVITY_EVENT_TYPES).toContain("browser_test.run_failed");
    expect(ACTIVITY_EVENT_TYPES).toContain("push_device.registered");
  });

  it("remembers the chosen filter under a namespaced key", () => {
    expect(ACTIVITY_TYPE_STORAGE_KEY).toBe("zenguy-admin:activity-type");
  });
});

describe("labelForType", () => {
  it("reads the subject and the verb phrase as a sentence", () => {
    expect(labelForType("browser_test.run_failed")).toBe("Browser test · run failed");
    expect(labelForType("user.logged_in")).toBe("User · logged in");
    expect(labelForType("alert.sent")).toBe("Alert · sent");
    expect(labelForType("security.encryption_rotated")).toBe("Security · encryption rotated");
  });

  it("spells the one acronym in the catalog properly", () => {
    expect(labelForType("api_key.revoked")).toBe("API key · revoked");
  });

  it("falls back to the raw type when it is not a subject.verb", () => {
    expect(labelForType("weird")).toBe("Weird");
    expect(labelForType("")).toBe("");
  });
});

describe("groupActivityTypes", () => {
  it("groups the catalog by subject, keeping every type exactly once", () => {
    const groups = groupActivityTypes();
    const flat = groups.flatMap((group) => group.options.map((option) => option.type));

    expect(flat).toHaveLength(ACTIVITY_EVENT_TYPES.length);
    expect([...flat].sort()).toEqual([...ACTIVITY_EVENT_TYPES].sort());
    expect(groups).toHaveLength(18);
    expect(groups.map((group) => group.subject)[0]).toBe("User");
  });

  it("collects a subject that reappears later in the catalog into one group", () => {
    // `browser_test.viewed` sits far above `browser_test.run_failed` in the
    // catalog; the filter must still offer them under one heading.
    const tests = groupActivityTypes().find((group) => group.subject === "Browser test");
    expect(tests?.options.map((option) => option.type)).toContain("browser_test.viewed");
    expect(tests?.options.map((option) => option.type)).toContain("browser_test.run_failed");
    expect(tests?.options.find((option) => option.type === "browser_test.run_failed")?.label).toBe(
      "run failed",
    );
  });
});

describe("parseActivityType", () => {
  it("accepts a type the catalog knows and rejects anything else", () => {
    expect(parseActivityType("alert.sent")).toBe("alert.sent");
    expect(parseActivityType("alert.sent.twice")).toBeNull();
    expect(parseActivityType("")).toBeNull();
    expect(parseActivityType(null)).toBeNull();
  });
});

describe("propertiesSummary", () => {
  it("says nothing when the event carries no properties", () => {
    expect(propertiesSummary(null)).toBeNull();
    expect(propertiesSummary({})).toBeNull();
  });

  it("joins the pairs on one line and stringifies non-string values", () => {
    expect(propertiesSummary({ channel: "email" })).toBe("channel: email");
    expect(propertiesSummary({ attempts: 2, ok: false, route: "/tests" })).toBe(
      "attempts: 2 · ok: false · route: /tests",
    );
    expect(propertiesSummary({ target: null, via: { kind: "sms" } })).toBe(
      'target: null · via: {"kind":"sms"}',
    );
  });

  it("truncates a long summary instead of wrapping the row", () => {
    const summary = propertiesSummary({ note: "x".repeat(200) });
    expect(summary).toHaveLength(80);
    expect(summary?.startsWith("note: xxx")).toBe(true);
    expect(summary?.endsWith("…")).toBe(true);
  });
});

describe("shortId", () => {
  it("keeps the prefix and the tail of a ULID, which is where ids differ", () => {
    // Ids are `prefix_<ulid>`; ULIDs share their leading characters within the
    // same millisecond range, so a head-only truncation would hide the id.
    expect(shortId("ntf_01jabcdefghijklmnopqrstuv")).toBe("ntf_…qrstuv");
    expect(shortId("usr_seed_marcos")).toBe("usr_…marcos");
  });

  it("leaves a short id alone", () => {
    expect(shortId("mon_home")).toBe("mon_home");
    expect(shortId("nodash")).toBe("nodash");
    expect(shortId("")).toBe("");
  });
});

describe("joinWorkspaceRows", () => {
  const active: ActiveWorkspaceRow[] = [
    {
      lastRunAt: NOW - 5_000,
      monitors: 3,
      name: "Acme",
      runs: 42,
      subscription: "paddle",
      workspaceId: "ws_1",
    },
  ];

  it("attaches the analytics row of the same workspace and leaves the rest null", () => {
    const rows = joinWorkspaceRows([workspace(), workspace({ id: "ws_2", name: "Other" })], active);
    expect(rows[0]?.analytics?.runs).toBe(42);
    expect(rows[1]?.analytics).toBeNull();
  });

  it("keeps every workspace when analytics has not answered yet", () => {
    const rows = joinWorkspaceRows([workspace()], undefined);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.analytics).toBeNull();
  });

  it("sorts by last activity, newest first, with never-active workspaces last", () => {
    const rows = joinWorkspaceRows(
      [
        workspace({ id: "quiet", lastActiveAt: null }),
        workspace({ id: "old", lastActiveAt: NOW - 90_000 }),
        workspace({ id: "busy", lastActiveAt: NOW - 1_000 }),
        workspace({ createdAt: NOW - 10, id: "new-quiet", lastActiveAt: null }),
      ],
      undefined,
    );
    expect(rows.map((row) => row.id)).toEqual(["busy", "old", "new-quiet", "quiet"]);
  });
});
