import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RecentRun, UserSummary, WorkerSummary } from "../../shared/types";
import { RecentRunsTable } from "./RecentRunsTable";
import { Section } from "./Section";
import { UsersTable } from "./UsersTable";
import { WorkersSection } from "./WorkersSection";

const NOW = 1_800_000_000_000;

const onlineWorker: WorkerSummary = {
  currentAttempt: {
    attemptId: "attempt_1",
    runId: "run_9f3a",
    startedAt: NOW - 8_000,
    testName: "Homepage",
    workspaceName: "Acme",
  },
  firstSeenAt: NOW - 900_000,
  id: "mac-studio",
  lastSeenAt: NOW - 2_000,
  mode: "local",
  online: true,
  runs24h: 42,
  runs7d: 310,
  startedAt: NOW - 7_200_000,
  tokens24h: 12_400,
  version: "1.4.2",
};

const offlineWorker: WorkerSummary = {
  currentAttempt: null,
  firstSeenAt: NOW - 900_000,
  id: "hetzner-vps",
  lastSeenAt: NOW - 60_000,
  mode: "fallback",
  online: false,
  runs24h: 0,
  runs7d: 4,
  startedAt: NOW - 3_600_000,
  tokens24h: 0,
  version: "1.4.1",
};

describe("workers section", () => {
  it("explains the pending migration instead of showing an empty list", () => {
    const html = renderToStaticMarkup(
      <WorkersSection workers={{ unavailable: "MIGRATION_PENDING" }} />,
    );
    expect(html).toContain("Pending production migration");
  });

  it("shows an empty state when no worker has ever reported", () => {
    const html = renderToStaticMarkup(<WorkersSection workers={{ now: NOW, workers: [] }} />);
    expect(html).toContain("No workers have reported yet");
  });

  it("shows liveness, mode, version and the running attempt of each worker", () => {
    const html = renderToStaticMarkup(
      <WorkersSection workers={{ now: NOW, workers: [onlineWorker, offlineWorker] }} />,
    );
    expect(html).toContain("Online");
    expect(html).toContain("mac-studio");
    expect(html).toContain("Primary (Mac)");
    expect(html).toContain("1.4.2");
    expect(html).toContain("Running Homepage");
    expect(html).toContain("run_9f3a");
    expect(html).toContain("Offline");
    expect(html).toContain("60s ago");
    expect(html).toContain("Fallback (VPS)");
    expect(html).toContain("Idle");
  });

  it("attributes runs and tokens to the worker that did the work", () => {
    const html = renderToStaticMarkup(
      <WorkersSection workers={{ now: NOW, workers: [onlineWorker] }} />,
    );
    expect(html).toContain("Runs 24 h");
    expect(html).toContain("42");
    expect(html).toContain("Runs 7 d");
    expect(html).toContain("310");
    expect(html).toContain("Tokens 24 h");
    expect(html).toContain("12.4k");
  });
});

describe("users table", () => {
  it("shows an empty state with no accounts", () => {
    const html = renderToStaticMarkup(<UsersTable now={NOW} users={[]} />);
    expect(html).toContain("No users yet");
  });

  it("marks accounts that never signed in", () => {
    const user: UserSummary = {
      createdAt: NOW - 86_400_000,
      email: "ana@example.com",
      emailVerified: true,
      id: "user_1",
      lastActiveAt: null,
      name: "Ana Ruiz",
      workspaceCount: 2,
    };
    const html = renderToStaticMarkup(<UsersTable now={NOW} users={[user]} />);
    expect(html).toContain("ana@example.com");
    expect(html).toContain("No activity");
  });
});

describe("recent runs table", () => {
  it("labels runner attribution as pending until the migration lands", () => {
    const run: RecentRun = {
      attemptCount: 2,
      createdAt: NOW - 90_000,
      durationMs: 64_000,
      id: "run_1",
      passedAfterRetry: true,
      runnerId: "MIGRATION_PENDING",
      runnerKind: null,
      source: "SCHEDULE",
      status: "PASSED",
      testName: "Checkout",
      workspaceName: "Acme",
    };
    const html = renderToStaticMarkup(<RecentRunsTable now={NOW} runs={[run]} />);
    expect(html).toContain("Checkout");
    expect(html).toContain("1m 04s");
    expect(html).toContain("pending");
  });

  it("shows an empty state with no runs", () => {
    const html = renderToStaticMarkup(<RecentRunsTable now={NOW} runs={[]} />);
    expect(html).toContain("No runs yet");
  });
});

describe("section wrapper", () => {
  const failed = new Error("D1 is unreachable");

  it("keeps the last data on screen and flags it as stale", () => {
    const html = renderToStaticMarkup(
      <Section
        now={NOW}
        query={{
          data: "cached numbers",
          dataUpdatedAt: NOW - 124_000,
          error: failed,
          isError: true,
          isPending: false,
          refetch: () => {},
        }}
        subject="workers"
        title="Workers"
      >
        {(data) => <p>{data}</p>}
      </Section>,
    );
    expect(html).toContain("cached numbers");
    expect(html).toContain("Stale — last updated 2m 4s ago");
  });

  it("offers a retry when the section has nothing cached to show", () => {
    const html = renderToStaticMarkup(
      <Section
        now={NOW}
        query={{
          data: undefined,
          dataUpdatedAt: 0,
          error: failed,
          isError: true,
          isPending: false,
          refetch: () => {},
        }}
        subject="workers"
        title="Workers"
      >
        {() => <p>never rendered</p>}
      </Section>,
    );
    expect(html).toContain("D1 is unreachable");
    expect(html).toContain("Try again");
    expect(html).not.toContain("never rendered");
  });

  it("announces the first load", () => {
    const html = renderToStaticMarkup(
      <Section
        now={NOW}
        query={{
          data: undefined,
          dataUpdatedAt: 0,
          error: null,
          isError: false,
          isPending: true,
          refetch: () => {},
        }}
        subject="workers"
        title="Workers"
      >
        {() => <p>never rendered</p>}
      </Section>,
    );
    expect(html).toContain("Loading workers…");
    expect(html).not.toContain("Stale");
  });
});
