import { AttemptDetail } from "@zenguy/frontend";

// AttemptDetail fetches its data with react-query; the preview serves the
// fixture through a scoped fetch mock so the real (non-skeleton) UI renders.

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

const failShots = [
  shot("shot_f1", "Home — Aurora Plants", "#4f46e5"),
  shot("shot_f2", "Checkout — payment", "#4f46e5"),
  shot("shot_f3", "Cart stuck on spinner", "#dc2626"),
];

const FAILED_ATTEMPT = {
  actualResult:
    "The cart page stayed visible with a loading spinner; no confirmation or order number appeared within 60 s.",
  attemptIndex: 1,
  consoleErrors: [
    {
      level: "error",
      message: "Uncaught TypeError: Cannot read properties of undefined (reading 'clientSecret')",
      timestamp: "2024-05-15T11:55:48.000Z",
      url: "https://aurora-plants.com/assets/checkout-9f31.js",
    },
    {
      level: "error",
      message: "[payments] Failed to create PaymentIntent: upstream returned 502",
      timestamp: "2024-05-15T11:55:49.000Z",
      url: null,
    },
  ],
  durationMs: 74_000,
  expectedResult:
    "The order confirmation page shows an order number and a “Thanks for your purchase” message.",
  failureReason:
    "The payment form never completed: clicking “Complete purchase” left the cart on a loading spinner and no confirmation page appeared.",
  finishedAt: "2024-05-15T11:56:32.000Z",
  id: "att_fail01",
  inputTokens: 41_250,
  latestScreenshot: { id: "shot_f3", url: failShots[2].url },
  latestStep: {
    actionType: "click",
    description: "Click “Complete purchase”",
    timestamp: "2024-05-15T11:55:47.000Z",
  },
  modelName: "claude-sonnet-4-5",
  networkErrors: [
    {
      durationMs: 1_840,
      errorType: null,
      host: "api.aurora-plants.com",
      method: "POST",
      path: "/v1/payment-intents",
      statusCode: 502,
    },
    {
      durationMs: null,
      errorType: "net::ERR_TIMED_OUT",
      host: "js.payments-cdn.com",
      method: "GET",
      path: "/v3/elements.js",
      statusCode: null,
    },
  ],
  outputTokens: 2_894,
  queuedAt: "2024-05-15T11:54:02.000Z",
  retryDelaySeconds: 60,
  runnerKind: "primary",
  runnerVersion: "zenguy-runner/3.4.1",
  screenshots: failShots,
  startedAt: "2024-05-15T11:55:18.000Z",
  status: "FAILED",
  steps: [
    {
      actionType: "goto",
      description: "Open aurora-plants.com and dismiss the cookie banner",
      result: "OK",
      screenshot: failShots[0],
      sequence: 1,
      timestamp: "2024-05-15T11:55:21.000Z",
      urlSanitized: "https://aurora-plants.com/",
    },
    {
      actionType: "fill",
      description: "Fill the payment form with the 4242 test card",
      result: "OK",
      screenshot: failShots[1],
      sequence: 2,
      timestamp: "2024-05-15T11:55:39.000Z",
      urlSanitized: "https://aurora-plants.com/checkout?step=payment",
    },
    {
      actionType: "click",
      description: "Click “Complete purchase” and wait for the confirmation page",
      result: "ERROR",
      screenshot: failShots[2],
      sequence: 3,
      timestamp: "2024-05-15T11:55:47.000Z",
      urlSanitized: "https://aurora-plants.com/checkout?step=payment",
    },
  ],
  summary: "Checkout stalled after submitting payment — no confirmation page was reached.",
  systemErrorCode: null,
  tokenUsage: 44_144,
  visitedUrls: [
    "https://aurora-plants.com/",
    "https://aurora-plants.com/products/monstera-xl",
    "https://aurora-plants.com/checkout?step=payment",
  ],
};

const passShots = [
  shot("shot_p1", "Product — Monstera XL", "#4f46e5"),
  shot("shot_p2", "Order #AP-10382 confirmed", "#059669"),
];

const PASSED_ATTEMPT = {
  actualResult: null,
  attemptIndex: 0,
  consoleErrors: [],
  durationMs: 58_000,
  expectedResult: null,
  failureReason: null,
  finishedAt: "2024-05-15T11:42:10.000Z",
  id: "att_pass01",
  inputTokens: 32_804,
  latestScreenshot: { id: "shot_p2", url: passShots[1].url },
  latestStep: {
    actionType: "done",
    description: "Order confirmation page verified",
    timestamp: "2024-05-15T11:42:08.000Z",
  },
  modelName: "claude-sonnet-4-5",
  networkErrors: [],
  outputTokens: 2_112,
  queuedAt: "2024-05-15T11:41:05.000Z",
  retryDelaySeconds: 0,
  runnerKind: "primary",
  runnerVersion: "zenguy-runner/3.4.1",
  screenshots: passShots,
  startedAt: "2024-05-15T11:41:12.000Z",
  status: "PASSED",
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
      actionType: "done",
      description: "Verify the confirmation page shows order #AP-10382",
      result: "OK",
      screenshot: passShots[1],
      sequence: 2,
      timestamp: "2024-05-15T11:42:08.000Z",
      urlSanitized: "https://aurora-plants.com/checkout/confirmation",
    },
  ],
  summary: "Added “Monstera XL” to the cart and completed checkout with the test card.",
  systemErrorCode: null,
  tokenUsage: 34_916,
  visitedUrls: [
    "https://aurora-plants.com/products/monstera-xl",
    "https://aurora-plants.com/checkout/confirmation",
  ],
};

const routes: Record<string, unknown> = {
  "/api/workspaces/ws_aurora/attempts/att_fail01": FAILED_ATTEMPT,
  "/api/workspaces/ws_aurora/attempts/att_pass01": PASSED_ATTEMPT,
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

export const FailedCheckout = () => (
  <div style={{ width: 760 }}>
    <AttemptDetail attemptId="att_fail01" timezone="Europe/Madrid" wsId="ws_aurora" />
  </div>
);

export const PassedCheckout = () => (
  <div style={{ width: 760 }}>
    <AttemptDetail attemptId="att_pass01" timezone="Europe/Madrid" wsId="ws_aurora" />
  </div>
);
