import { RunStatusPanel } from "@zenguy/frontend";

// RunStatusPanel drives everything through react-query (run + latest attempt);
// the preview answers those requests with fixtures via a scoped fetch mock so
// the real states render instead of the loading skeleton.

const EXPIRES = "2024-05-16T12:00:00.000Z";

function shotUrl(label: string, accent: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">` +
    `<rect width="640" height="420" fill="#fafafa"/>` +
    `<rect width="640" height="44" fill="#18181b"/>` +
    `<rect x="84" y="12" width="300" height="20" rx="10" fill="#27272a"/>` +
    `<text x="98" y="26" font-family="Arial" font-size="12" fill="#a1a1aa">aurora-plants.com</text>` +
    `<rect x="40" y="90" width="560" height="10" rx="5" fill="#e4e4e7"/>` +
    `<rect x="40" y="118" width="420" height="10" rx="5" fill="#e4e4e7"/>` +
    `<rect x="40" y="170" width="180" height="44" rx="8" fill="${accent}"/>` +
    `<text x="40" y="280" font-family="Arial" font-size="24" fill="#3f3f46">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const shot = (id: string, label: string, accent: string) => ({
  expiresAt: EXPIRES,
  id,
  url: shotUrl(label, accent),
});

const SNAPSHOT = {
  channelIds: [],
  device: "DESKTOP",
  instructions: "Add “Monstera XL” to the cart and pay with the test card.",
  intervalHours: 24,
  maxRetries: 1,
  modelName: "claude-sonnet-4-5",
  name: "Checkout flow",
  notifyOnRecovery: true,
  runnerVersion: "zenguy-runner/3.4.1",
  startUrl: "https://aurora-plants.com",
  viewport: { height: 900, width: 1440 },
};

const passShots = [
  shot("shot_p1", "Product — Monstera XL", "#4f46e5"),
  shot("shot_p2", "Checkout — payment", "#4f46e5"),
  shot("shot_p3", "Order #AP-10382 confirmed", "#059669"),
];

const PASS_SUMMARY = {
  attemptIndex: 0,
  durationMs: 58_000,
  failureReason: null,
  finishedAt: "2024-05-15T11:42:10.000Z",
  id: "att_p1",
  inputTokens: 32_804,
  latestScreenshot: { id: "shot_p3", url: passShots[2].url },
  latestStep: {
    actionType: "done",
    description: "Verified the order confirmation page shows order #AP-10382.",
    timestamp: "2024-05-15T11:42:08.000Z",
  },
  modelName: "claude-sonnet-4-5",
  outputTokens: 2_112,
  queuedAt: "2024-05-15T11:41:05.000Z",
  retryDelaySeconds: 0,
  runnerKind: "primary",
  runnerVersion: "zenguy-runner/3.4.1",
  startedAt: "2024-05-15T11:41:12.000Z",
  status: "PASSED",
  summary: "Checkout completed with the test card.",
  tokenUsage: 34_916,
};

const PASS_ATTEMPT = {
  ...PASS_SUMMARY,
  actualResult: null,
  consoleErrors: [],
  expectedResult: null,
  networkErrors: [],
  screenshots: passShots,
  steps: [
    {
      actionType: "click",
      description: "Add “Monstera XL” to the cart",
      result: "OK",
      screenshot: passShots[0],
      sequence: 1,
      timestamp: "2024-05-15T11:41:31.000Z",
      urlSanitized: "https://aurora-plants.com/products/monstera-xl",
    },
    {
      actionType: "fill",
      description: "Pay with the 4242 test card",
      result: "OK",
      screenshot: passShots[1],
      sequence: 2,
      timestamp: "2024-05-15T11:41:52.000Z",
      urlSanitized: "https://aurora-plants.com/checkout?step=payment",
    },
    {
      actionType: "done",
      description: "Verify the confirmation page shows order #AP-10382",
      result: "OK",
      screenshot: passShots[2],
      sequence: 3,
      timestamp: "2024-05-15T11:42:08.000Z",
      urlSanitized: "https://aurora-plants.com/checkout/confirmation",
    },
  ],
  systemErrorCode: null,
  visitedUrls: [
    "https://aurora-plants.com/",
    "https://aurora-plants.com/products/monstera-xl",
    "https://aurora-plants.com/checkout/confirmation",
  ],
};

const PASSED_RUN = {
  attemptCount: 1,
  attempts: [PASS_SUMMARY],
  billable: true,
  durationMs: 58_000,
  finishedAt: "2024-05-15T11:42:10.000Z",
  id: "run_pass01",
  incidentId: null,
  live: null,
  passedAfterRetry: false,
  queuedAt: "2024-05-15T11:41:05.000Z",
  scheduledFor: null,
  snapshot: SNAPSHOT,
  source: "SCHEDULED",
  startedAt: "2024-05-15T11:41:12.000Z",
  status: "PASSED",
  testId: "bt_checkout",
  triggeredBy: null,
};

const failShots = [
  shot("shot_f1", "Checkout — payment", "#4f46e5"),
  shot("shot_f2", "Cart stuck on spinner", "#dc2626"),
];

const FAIL_SUMMARY_1 = {
  attemptIndex: 0,
  durationMs: 71_000,
  failureReason:
    "Clicking “Complete purchase” left the cart on a loading spinner; no confirmation page appeared.",
  finishedAt: "2024-05-15T11:50:29.000Z",
  id: "att_f1",
  inputTokens: 39_412,
  latestScreenshot: { id: "shot_f2", url: failShots[1].url },
  latestStep: {
    actionType: "click",
    description: "Click “Complete purchase” and wait for the confirmation page.",
    timestamp: "2024-05-15T11:50:22.000Z",
  },
  modelName: "claude-sonnet-4-5",
  outputTokens: 2_731,
  queuedAt: "2024-05-15T11:49:02.000Z",
  retryDelaySeconds: 0,
  runnerKind: "primary",
  runnerVersion: "zenguy-runner/3.4.1",
  startedAt: "2024-05-15T11:49:18.000Z",
  status: "FAILED",
  summary: "Checkout stalled after submitting payment.",
  tokenUsage: 42_143,
};

const FAIL_SUMMARY_2 = {
  ...FAIL_SUMMARY_1,
  attemptIndex: 1,
  durationMs: 74_000,
  finishedAt: "2024-05-15T11:56:32.000Z",
  id: "att_f2",
  queuedAt: "2024-05-15T11:54:02.000Z",
  retryDelaySeconds: 60,
  startedAt: "2024-05-15T11:55:18.000Z",
};

const FAIL_ATTEMPT_2 = {
  ...FAIL_SUMMARY_2,
  actualResult:
    "The cart page stayed visible with a loading spinner; no confirmation or order number appeared within 60 s.",
  consoleErrors: [],
  expectedResult:
    "The order confirmation page shows an order number and a “Thanks for your purchase” message.",
  networkErrors: [],
  screenshots: failShots,
  steps: [
    {
      actionType: "fill",
      description: "Fill the payment form with the 4242 test card",
      result: "OK",
      screenshot: failShots[0],
      sequence: 1,
      timestamp: "2024-05-15T11:55:39.000Z",
      urlSanitized: "https://aurora-plants.com/checkout?step=payment",
    },
    {
      actionType: "click",
      description: "Click “Complete purchase” and wait for the confirmation page",
      result: "ERROR",
      screenshot: failShots[1],
      sequence: 2,
      timestamp: "2024-05-15T11:55:47.000Z",
      urlSanitized: "https://aurora-plants.com/checkout?step=payment",
    },
  ],
  systemErrorCode: null,
  visitedUrls: [
    "https://aurora-plants.com/",
    "https://aurora-plants.com/checkout?step=payment",
  ],
};

const FAILED_RUN = {
  attemptCount: 2,
  attempts: [FAIL_SUMMARY_1, FAIL_SUMMARY_2],
  billable: true,
  durationMs: 74_000,
  finishedAt: "2024-05-15T11:56:32.000Z",
  id: "run_fail01",
  incidentId: "inc_7d20c1",
  live: null,
  passedAfterRetry: false,
  queuedAt: "2024-05-15T11:49:02.000Z",
  scheduledFor: null,
  snapshot: SNAPSHOT,
  source: "SCHEDULED",
  startedAt: "2024-05-15T11:49:18.000Z",
  status: "FAILED",
  testId: "bt_checkout",
  triggeredBy: null,
};

const RUNNING_RUN = {
  attemptCount: 1,
  attempts: [
    {
      ...PASS_SUMMARY,
      durationMs: null,
      finishedAt: null,
      id: "att_l1",
      latestScreenshot: { id: "shot_l1", url: shotUrl("Checkout — payment", "#4f46e5") },
      latestStep: {
        actionType: "fill",
        description: "Filling the payment form with the 4242 test card…",
        timestamp: "2024-05-15T11:59:52.000Z",
      },
      queuedAt: "2024-05-15T11:59:03.000Z",
      startedAt: "2024-05-15T11:59:15.000Z",
      status: "RUNNING",
      summary: null,
      tokenUsage: null,
      inputTokens: null,
      outputTokens: null,
    },
  ],
  billable: true,
  durationMs: null,
  finishedAt: null,
  id: "run_live01",
  incidentId: null,
  live: null,
  passedAfterRetry: false,
  queuedAt: "2024-05-15T11:59:03.000Z",
  scheduledFor: null,
  snapshot: SNAPSHOT,
  source: "MANUAL",
  startedAt: "2024-05-15T11:59:15.000Z",
  status: "RUNNING",
  testId: "bt_checkout",
  triggeredBy: { name: "Marcos", userId: "usr_marcos" },
};

const routes: Record<string, unknown> = {
  "/api/workspaces/ws_aurora/attempts/att_f2": FAIL_ATTEMPT_2,
  "/api/workspaces/ws_aurora/attempts/att_p1": PASS_ATTEMPT,
  "/api/workspaces/ws_aurora/runs/run_fail01": FAILED_RUN,
  "/api/workspaces/ws_aurora/runs/run_live01": RUNNING_RUN,
  "/api/workspaces/ws_aurora/runs/run_pass01": PASSED_RUN,
};

const realFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const hit = routes[path];
  if (hit !== undefined) {
    return Promise.resolve(
      new Response(JSON.stringify({ data: hit }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
  }
  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;

export const PassedRun = () => (
  <div style={{ width: 720 }}>
    <RunStatusPanel runId="run_pass01" wsId="ws_aurora" />
  </div>
);

export const FailedAfterRetry = () => (
  <div style={{ width: 720 }}>
    <RunStatusPanel runId="run_fail01" wsId="ws_aurora" />
  </div>
);

export const CompactRunning = () => (
  <div style={{ width: 420 }}>
    <RunStatusPanel compact runId="run_live01" wsId="ws_aurora" />
  </div>
);
