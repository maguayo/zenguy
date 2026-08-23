import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ActiveWorkspaceRow,
  ActivityFeedEvent,
  WorkspaceActivitySummary,
} from "../../shared/types";
import { ActivityFeed } from "./ActivityFeed";
import { WorkspacesTable } from "./WorkspacesTable";

const NOW = 1_800_000_000_000;

const systemEvent: ActivityFeedEvent = {
  actor: null,
  id: "act_01jsystem",
  occurredAt: NOW - 4_000,
  properties: { channel: "email", to: "ops@example.com" },
  resourceId: "ntf_01jabcdefghijklmnopqrstuv",
  resourceType: "notification_delivery",
  source: "server",
  type: "alert.sent",
  workspace: { id: "ws_1", name: "Acme" },
};

const userEvent: ActivityFeedEvent = {
  actor: { email: "ana@example.com", id: "usr_1", name: "Ana Ruiz" },
  id: "act_01juser",
  occurredAt: NOW - 130_000,
  properties: null,
  resourceId: null,
  resourceType: null,
  source: "web",
  type: "browser_test.run_failed",
  workspace: null,
};

function feed(events: ActivityFeedEvent[], type: string | null = null) {
  return renderToStaticMarkup(
    <ActivityFeed feed={{ events }} now={NOW} onTypeChange={() => {}} type={type} />,
  );
}

describe("activity feed", () => {
  it("reads each event as who did what, where and from which client", () => {
    const html = feed([systemEvent, userEvent]);

    expect(html).toContain("Alert · sent");
    expect(html).toContain("Browser test · run failed");
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain("ana@example.com");
    expect(html).toContain("system");
    expect(html).toContain("Acme");
    expect(html).toContain("4s ago");
    expect(html).toContain("2m 10s ago");
    // The source badge is a fact about the client, never a verdict: zinc.
    expect(html).toContain(">server<");
    expect(html).toContain(">web<");
    expect(html).toContain("bg-zinc-100");
  });

  it("summarises the properties of an event on one line and drops the empty ones", () => {
    const html = feed([systemEvent, userEvent]);
    expect(html).toContain("channel: email · to: ops@example.com");
    // Two events, one summary line.
    expect(html.match(/channel: email/g)).toHaveLength(1);
  });

  it("shortens a resource id but keeps the whole one within reach", () => {
    const html = feed([systemEvent]);
    expect(html).toContain("notification_delivery");
    expect(html).toContain("ntf_…qrstuv");
    expect(html).toContain('title="ntf_01jabcdefghijklmnopqrstuv"');
  });

  it("shows an em dash where an event has no workspace or no resource", () => {
    const html = feed([userEvent]);
    expect(html.match(/—/g)?.length).toBe(2);
  });

  it("offers every catalog type grouped by subject, with the chosen one selected", () => {
    const html = feed([systemEvent], "browser_test.run_failed");

    expect(html).toContain("All events");
    expect(html).toContain('<optgroup label="Browser test">');
    expect(html).toContain('value="browser_test.run_failed"');
    const chosen = html.split("<option").find((chunk) => chunk.includes("run failed"));
    expect(chosen).toContain("selected");
    expect(html.match(/selected=""/g)).toHaveLength(1);
  });

  it("explains the pending migration instead of showing an empty feed", () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        feed={{ unavailable: "MIGRATION_PENDING" }}
        now={NOW}
        onTypeChange={() => {}}
        type={null}
      />,
    );
    expect(html).toContain("Pending production migration (activity events)");
  });

  it("says what is missing when the feed is empty, filter included", () => {
    expect(feed([])).toContain("No events yet");
    expect(feed([], "alert.sent")).toContain("No Alert · sent events yet");
  });
});

function workspace(over: Partial<WorkspaceActivitySummary> = {}): WorkspaceActivitySummary {
  return {
    createdAt: NOW - 172_800_000,
    id: "ws_1",
    lastActiveAt: NOW - 4_000,
    lastAlertSentAt: NOW - 60_000,
    lastAppAt: NOW - 20_000,
    lastLoginAt: NOW - 9_000,
    lastRunAt: NOW - 8_000,
    lastRunStatus: "FAILED",
    lastTestCreatedAt: null,
    lastWebAt: NOW - 5_000,
    memberCount: 3,
    name: "Acme",
    ownerEmail: "ana@example.com",
    slug: "acme",
    ...over,
  };
}

const activeRow: ActiveWorkspaceRow = {
  lastRunAt: NOW - 8_000,
  monitors: 4,
  name: "Acme",
  runs: 128,
  subscription: "paddle",
  workspaceId: "ws_1",
};

describe("workspaces table", () => {
  it("joins the activity columns with the 30-day analytics of the same workspace", () => {
    const html = renderToStaticMarkup(
      <WorkspacesTable active={[activeRow]} now={NOW} workspaces={{ workspaces: [workspace()] }} />,
    );

    expect(html).toContain("Acme");
    expect(html).toContain("acme");
    expect(html).toContain("ana@example.com");
    expect(html).toContain("Paying");
    expect(html).toContain("128");
    expect(html).toContain(">4<");
    expect(html).toContain(">3<");
    expect(html).toContain("FAILED");
    expect(html).toContain("1 workspace · sorted by last activity");
  });

  it("does not invent analytics for a workspace that ran nothing in 30 days", () => {
    const html = renderToStaticMarkup(
      <WorkspacesTable
        active={[activeRow]}
        now={NOW}
        workspaces={{ workspaces: [workspace({ id: "ws_2", name: "Quiet", slug: "quiet" })] }}
      />,
    );
    expect(html).toContain("Quiet");
    expect(html).not.toContain("Paying");
    expect(html).not.toContain("128");
  });

  it("shows an em dash for every thing a workspace has never done", () => {
    const html = renderToStaticMarkup(
      <WorkspacesTable
        active={[]}
        now={NOW}
        workspaces={{
          workspaces: [
            workspace({
              lastActiveAt: null,
              lastAlertSentAt: null,
              lastAppAt: null,
              lastLoginAt: null,
              lastRunAt: null,
              lastRunStatus: null,
              lastWebAt: null,
              ownerEmail: null,
            }),
          ],
        }}
      />,
    );
    // Plan, runs, monitors, last run, last login, last web, last app, last alert.
    expect(html.match(/—/g)?.length).toBe(8);
    expect(html).not.toContain("FAILED");
  });

  it("keeps the analytics-only table while the activity migration is pending", () => {
    const html = renderToStaticMarkup(
      <WorkspacesTable
        active={[activeRow]}
        now={NOW}
        workspaces={{ unavailable: "MIGRATION_PENDING" }}
      />,
    );
    expect(html).toContain("Activity columns pending production migration");
    expect(html).toContain("Acme");
    expect(html).toContain("Paying");
    expect(html).toContain("128");
    expect(html).toContain("4");
    expect(html).not.toContain("Last login");
  });

  it("keeps the analytics fallback honest about a workspace with no run and no plan", () => {
    const html = renderToStaticMarkup(
      <WorkspacesTable
        active={[{ ...activeRow, lastRunAt: null, subscription: "none" }]}
        now={NOW}
        workspaces={{ unavailable: "MIGRATION_PENDING" }}
      />,
    );
    expect(html).toContain("Never");
    expect(html).toContain("No plan");
  });

  it("says nothing ran rather than drawing an empty analytics fallback", () => {
    const html = renderToStaticMarkup(
      <WorkspacesTable active={[]} now={NOW} workspaces={{ unavailable: "MIGRATION_PENDING" }} />,
    );
    expect(html).toContain("No workspace ran anything in the last 30 days");
  });

  it("says so plainly when there is no workspace at all", () => {
    const html = renderToStaticMarkup(
      <WorkspacesTable active={[]} now={NOW} workspaces={{ workspaces: [] }} />,
    );
    expect(html).toContain("No workspaces yet");
  });
});
