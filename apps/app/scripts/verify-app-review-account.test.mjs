import assert from "node:assert/strict";
import test from "node:test";

import {
  AppReviewAccountVerificationError,
  verifyAppReviewAccount,
} from "./verify-app-review-account.mjs";

const reviewEmail = "apple-review@zenguy.com";
const reviewPassword = "Review-only-password-2026!";
const primaryAccess = "primary-access-token-1234567890";
const primaryRefresh = "primary-refresh-token-123456789";
const secondaryAccess = "secondary-access-token-12345678";
const secondaryRefresh = "secondary-refresh-token-123456";

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify({ data, ...extra }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function fixtureFetch({
  channelEmail = reviewEmail,
  evidence = true,
  evidenceUrl = `/api/artifact-content?id=artifact-review&exp=${Math.floor(Date.now() / 1_000) + 600}&sig=${"a".repeat(43)}`,
  primaryStillValid = true,
} = {}) {
  const calls = [];
  let loginCount = 0;
  const user = {
    email: reviewEmail,
    emailVerified: true,
    id: "usr-review",
    name: "Apple Reviewer",
  };
  const workspace = {
    id: "ws-review",
    name: "Zenguy Review",
    role: "OWNER",
    subscriptionStatus: "ACTIVE",
  };
  const tests = [
    {
      id: "test-blog",
      name: "Blog listing",
      startUrl: "https://example.com/blog",
    },
    {
      id: "test-search",
      name: "Search filters",
      startUrl: "https://example.com/search",
    },
  ];

  const fetchFn = async (input, init = {}) => {
    const url = new URL(String(input));
    const authorization = new Headers(init.headers).get("Authorization");
    calls.push({ authorization, method: init.method ?? "GET", path: `${url.pathname}${url.search}` });

    if (url.pathname === "/api/auth/login") {
      loginCount += 1;
      return json({
        accessToken: loginCount === 1 ? primaryAccess : secondaryAccess,
        expiresIn: 900,
        refreshExpiresIn: 2_592_000,
        refreshToken: loginCount === 1 ? primaryRefresh : secondaryRefresh,
        user,
      });
    }
    if (url.pathname === "/api/auth/logout") return new Response(null, { status: 204 });
    if (url.pathname === "/api/auth/me") {
      if (!primaryStillValid && authorization === `Bearer ${primaryAccess}`) {
        return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), {
          headers: { "Content-Type": "application/json" },
          status: 401,
        });
      }
      return json({ user });
    }
    if (url.pathname === "/api/workspaces") return json([workspace]);
    if (url.pathname === "/api/workspaces/ws-review/overview") {
      return json({
        activity: [{ id: "activity-1" }],
        browserTests: { total: 2 },
        uptime: { down: 0, unknown: 0, up: 1 },
      });
    }
    if (url.pathname === "/api/workspaces/ws-review/browser-tests" && url.search) {
      return json(tests, 200, { nextCursor: null });
    }
    if (url.pathname === "/api/workspaces/ws-review/uptime-monitors" && url.search) {
      return json([
        {
          id: "monitor-status",
          name: "Status API",
          url: "https://api.zenguy.com/api/health",
        },
      ]);
    }
    if (url.pathname === "/api/workspaces/ws-review/incidents" && url.search) {
      return json([
        {
          id: "incident-search",
          resourceId: "test-search",
          resourceName: "Search filters",
          resourceType: "BROWSER_TEST",
        },
      ]);
    }
    if (url.pathname === "/api/workspaces/ws-review/channels" && url.search) {
      return json([
        {
          configPreview: { emails: [channelEmail] },
          enabled: true,
          id: "channel-review",
          name: "Review alerts",
          type: "EMAIL",
        },
      ]);
    }
    if (url.pathname === "/api/workspaces/ws-review/members") {
      return json([
        { email: reviewEmail, name: "Apple Reviewer" },
        { email: "apple-review+teammate@zenguy.com", name: "Demo Teammate" },
      ]);
    }
    if (url.pathname === "/api/workspaces/ws-review/remote-ai-consent") {
      return json({
        acceptedAt: null,
        active: false,
        policyVersion: "2026-09-01-v1",
        provider: "OpenAI",
        revokedAt: null,
      });
    }
    if (url.pathname === "/api/workspaces/ws-review/browser-tests/test-blog/runs") {
      return json([{ attemptCount: 1, id: "run-blog", status: "PASSED" }]);
    }
    if (url.pathname === "/api/workspaces/ws-review/runs/run-blog") {
      return json({
        attempts: [{ id: "attempt-blog" }],
        id: "run-blog",
        status: "PASSED",
        testId: "test-blog",
      });
    }
    if (url.pathname === "/api/workspaces/ws-review/attempts/attempt-blog") {
      const screenshot = evidence
        ? { id: "artifact-review", url: evidenceUrl }
        : null;
      return json({
        screenshots: screenshot === null ? [] : [screenshot],
        steps: [{ screenshot }],
      });
    }
    if (url.pathname === "/api/artifact-content") {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "Content-Type": "image/png" },
        status: 200,
      });
    }
    if (url.pathname === "/api/workspaces/ws-review/uptime-monitors/monitor-status/stats") {
      return json({
        avgResponseTimeMs24h: 125,
        series: [
          { responseTimeMs: 120 },
          { responseTimeMs: 125 },
          { responseTimeMs: 130 },
        ],
      });
    }
    if (url.pathname === "/api/workspaces/ws-review/uptime-monitors/monitor-status/checks") {
      return json([{ id: "check-1", responseTimeMs: 125, status: "PASSED" }]);
    }
    if (url.pathname === "/api/workspaces/ws-review/incidents/incident-search") {
      return json({ events: [{ id: "opened" }, { id: "resolved" }] });
    }
    throw new Error(`Unexpected request ${url.pathname}${url.search}`);
  };
  return { calls, fetchFn };
}

test("verifies a deterministic review account and revokes both temporary sessions", async () => {
  const fixture = fixtureFetch();
  const result = await verifyAppReviewAccount({
    email: reviewEmail,
    fetchFn: fixture.fetchFn,
    password: reviewPassword,
    timeoutMs: 1_000,
  });

  assert.deepEqual(result, {
    channels: 1,
    incidents: 1,
    members: 2,
    monitors: 1,
    tests: 2,
  });
  assert.equal(fixture.calls.filter((call) => call.path === "/api/auth/login").length, 2);
  assert.equal(fixture.calls.filter((call) => call.path === "/api/auth/logout").length, 2);
  assert.equal(fixture.calls.filter((call) => call.path === "/api/auth/me").length, 2);
  assert.equal(
    fixture.calls.filter((call) => call.path.startsWith("/api/artifact-content?")).length,
    1,
  );
  for (const path of [
    "/api/workspaces/ws-review/overview",
    "/api/workspaces/ws-review/browser-tests?limit=100",
    "/api/workspaces/ws-review/uptime-monitors?limit=100",
    "/api/workspaces/ws-review/incidents?limit=100",
    "/api/workspaces/ws-review/channels?limit=100",
    "/api/workspaces/ws-review/members",
    "/api/workspaces/ws-review/remote-ai-consent",
  ]) {
    assert.equal(
      fixture.calls.filter((call) => call.path === path).length,
      1,
      `${path} should be fetched exactly once`,
    );
  }
});

test("rejects committed local fixture credentials before making a request", async () => {
  let called = false;
  await assert.rejects(
    verifyAppReviewAccount({
      email: reviewEmail,
      fetchFn: async () => {
        called = true;
        throw new Error("must not run");
      },
      password: "Local-demo-password-2026!",
    }),
    /committed local fixture passwords are forbidden/u,
  );
  assert.equal(called, false);
});

test("detects when a second login invalidates the first session and still logs out", async () => {
  const fixture = fixtureFetch({ primaryStillValid: false });
  await assert.rejects(
    verifyAppReviewAccount({
      email: reviewEmail,
      fetchFn: fixture.fetchFn,
      password: reviewPassword,
      timeoutMs: 1_000,
    }),
    (error) => {
      assert.ok(error instanceof AppReviewAccountVerificationError);
      assert.match(error.message, /HTTP 401 \(UNAUTHORIZED\)/u);
      assert.doesNotMatch(error.message, /apple-review|Review-only/u);
      return true;
    },
  );
  assert.equal(fixture.calls.filter((call) => call.path === "/api/auth/logout").length, 2);
});

test("rejects a completed demo run without screenshot evidence", async () => {
  const fixture = fixtureFetch({ evidence: false });
  await assert.rejects(
    verifyAppReviewAccount({
      email: reviewEmail,
      fetchFn: fixture.fetchFn,
      password: reviewPassword,
      timeoutMs: 1_000,
    }),
    /Blog listing lacks safe signed screenshot evidence/u,
  );
  assert.equal(fixture.calls.filter((call) => call.path === "/api/auth/logout").length, 2);
});

test("rejects screenshot evidence without the production signature contract", async () => {
  const fixture = fixtureFetch({
    evidenceUrl: "/api/artifact-content?token=ephemeral",
  });
  await assert.rejects(
    verifyAppReviewAccount({
      email: reviewEmail,
      fetchFn: fixture.fetchFn,
      password: reviewPassword,
      timeoutMs: 1_000,
    }),
    /Blog listing lacks safe signed screenshot evidence/u,
  );
  assert.equal(
    fixture.calls.filter((call) => call.path.startsWith("/api/artifact-content?")).length,
    0,
  );
  assert.equal(fixture.calls.filter((call) => call.path === "/api/auth/logout").length, 2);
});

test("rejects notification destinations outside the dedicated review mailbox", async () => {
  const fixture = fixtureFetch({ channelEmail: "customer@example.net" });
  await assert.rejects(
    verifyAppReviewAccount({
      email: reviewEmail,
      fetchFn: fixture.fetchFn,
      password: reviewPassword,
      timeoutMs: 1_000,
    }),
    /notification channel contains a non-approved destination/u,
  );
  assert.equal(fixture.calls.filter((call) => call.path === "/api/auth/logout").length, 2);
});
