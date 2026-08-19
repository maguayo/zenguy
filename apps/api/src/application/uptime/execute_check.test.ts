import type { ResolvedSecrets } from "../../domain/secrets/types";
import type { MonitorConfig } from "../../domain/uptime/rules";
import { FixedClock } from "../../shared/clock";
import { MAX_REDIRECTS, UPTIME_BODY_CAP } from "../../shared/constants";
import {
  executeCheck,
  type CheckOutcome,
  type UptimeFetch,
} from "./execute_check";

const WORKSPACE_ID = "ws_check_executor";
const BASE: MonitorConfig = {
  name: "Health",
  url: "https://api.example.com/health",
  method: "GET",
  expectedStatus: 200,
  frequencySeconds: 300,
  timeoutSeconds: 10,
  maxRetries: 1,
  notifyOnRecovery: true,
  channelIds: [],
};

class StaticResolver {
  readonly calls: Array<{ workspaceId: string; referencedKeys: string[] }> = [];

  constructor(private readonly secrets: ResolvedSecrets = new Map()) {}

  async execute(input: {
    workspaceId: string;
    referencedKeys: string[];
  }): Promise<ResolvedSecrets> {
    this.calls.push(structuredClone(input));
    return new Map(this.secrets);
  }
}

function config(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return { ...BASE, ...overrides };
}

async function run(input: {
  config?: MonitorConfig;
  fetchFn: UptimeFetch;
  secrets?: ResolvedSecrets;
  clock?: FixedClock;
}): Promise<CheckOutcome> {
  return executeCheck(
    {
      fetchFn: input.fetchFn,
      clock: input.clock ?? new FixedClock(1_000),
      resolveSecrets: new StaticResolver(input.secrets),
    },
    input.config ?? BASE,
    WORKSPACE_ID,
  );
}

function throwingFetch(error: Error): UptimeFetch {
  return async () => Promise.reject(error);
}

describe("executeCheck request failures", () => {
  it("returns BLOCKED_URL before sending a request", async () => {
    let calls = 0;
    const outcome = await run({
      config: config({ url: "http://169.254.169.254/latest" }),
      fetchFn: async () => {
        calls += 1;
        return new Response();
      },
    });
    expect(outcome).toMatchObject({ status: "FAILED", failureReason: "BLOCKED_URL" });
    expect(calls).toBe(0);
  });

  it("maps missing and domain-refused placeholders without sending requests", async () => {
    for (const value of [
      {
        secrets: new Map() as ResolvedSecrets,
        expected: "UNKNOWN_SECRET",
      },
      {
        secrets: new Map([
          ["API_TOKEN", { value: "raw-token", allowedDomains: ["other.example.com"] }],
        ]),
        expected: "SECRET_DOMAIN_NOT_ALLOWED",
      },
    ] as const) {
      let calls = 0;
      const outcome = await run({
        config: config({
          headers: [{ key: "Authorization", value: "Bearer {{API_TOKEN}}" }],
        }),
        secrets: value.secrets,
        fetchFn: async () => {
          calls += 1;
          return new Response();
        },
      });
      expect(outcome.failureReason).toBe(value.expected);
      expect(calls).toBe(0);
    }
  });

  it("maps timeout and Workers network failures", async () => {
    const timeout = new Error("aborted");
    timeout.name = "AbortError";
    await expect(
      run({ fetchFn: throwingFetch(timeout) }),
    ).resolves.toMatchObject({ failureReason: "TIMEOUT" });
    await expect(
      run({ fetchFn: throwingFetch(new TypeError("fetch failed")) }),
    ).resolves.toMatchObject({ failureReason: "CONNECTION_ERROR" });
  });

  it("records total elapsed time", async () => {
    const clock = new FixedClock(1_000);
    const outcome = await run({
      clock,
      fetchFn: async () => {
        clock.advance(37);
        return new Response(null, { status: 200 });
      },
    });
    expect(outcome).toMatchObject({ status: "PASSED", responseTimeMs: 37 });
  });
});

describe("executeCheck redirects", () => {
  it("revalidates every target and rejects an unsafe redirect", async () => {
    const outcome = await run({
      fetchFn: async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/admin" },
        }),
    });
    expect(outcome).toMatchObject({ failureReason: "UNSAFE_REDIRECT" });
  });

  it("fails after the fifth allowed redirect", async () => {
    let calls = 0;
    const outcome = await run({
      fetchFn: async () => {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: `/hop-${calls}` },
        });
      },
    });
    expect(outcome).toMatchObject({ failureReason: "TOO_MANY_REDIRECTS" });
    expect(calls).toBe(MAX_REDIRECTS + 1);
  });

  it("drops custom headers/body across hosts and downgrades 302 to GET", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      authorization: string | null;
      body: BodyInit | null | undefined;
      redirect: RequestRedirect | undefined;
    }> = [];
    const outcome = await run({
      config: config({
        method: "POST",
        headers: [{ key: "Authorization", value: "Bearer staging" }],
        body: '{"probe":true}',
      }),
      fetchFn: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: new Headers(init?.headers).get("Authorization"),
          body: init?.body,
          redirect: init?.redirect,
        });
        return requests.length === 1
          ? new Response(null, {
              status: 302,
              headers: { Location: "https://edge.example.net/final" },
            })
          : new Response(null, { status: 200 });
      },
    });
    expect(outcome.status).toBe("PASSED");
    expect(requests).toEqual([
      {
        url: "https://api.example.com/health",
        method: "POST",
        authorization: "Bearer staging",
        body: '{"probe":true}',
        redirect: "manual",
      },
      {
        url: "https://edge.example.net/final",
        method: "GET",
        authorization: null,
        body: undefined,
        redirect: "manual",
      },
    ]);
  });

  it("keeps method, headers, and body for same-host 307 redirects", async () => {
    const requests: RequestInit[] = [];
    const outcome = await run({
      config: config({
        method: "POST",
        headers: [{ key: "X-Probe", value: "yes" }],
        body: "payload",
      }),
      fetchFn: async (_url, init) => {
        requests.push(init ?? {});
        return requests.length === 1
          ? new Response(null, { status: 307, headers: { Location: "/final" } })
          : new Response(null, { status: 200 });
      },
    });
    expect(outcome.status).toBe("PASSED");
    expect(requests[1]).toMatchObject({ method: "POST", body: "payload" });
    expect(new Headers(requests[1]?.headers).get("X-Probe")).toBe("yes");
  });
});

describe("executeCheck conditions and evidence", () => {
  it("does not consume the response body when no body condition is configured", async () => {
    const response = new Response("should remain unread", { status: 503 });
    const outcome = await run({ fetchFn: async () => response });
    expect(outcome).toMatchObject({
      status: "FAILED",
      failureReason: "UNEXPECTED_STATUS",
      responseExcerpt: null,
    });
    expect(response.bodyUsed).toBe(false);
    expect(outcome.conditions).toEqual([
      {
        type: "status",
        passed: false,
        detail: "expected 200, got 503",
      },
    ]);
  });

  it.each([
    ["CONTAINS", "service healthy", "healthy"],
    ["NOT_CONTAINS", "service healthy", "failed"],
    ["EQUALS", "  healthy  ", "healthy"],
    ["JSON_PATH_EQUALS", '{"service":{"states":["ok"]}}', "ok"],
  ] as const)("passes the %s body condition", async (kind, body, expected) => {
    const outcome = await run({
      config: config({
        bodyCondition: kind,
        bodyExpectedValue: expected,
        ...(kind === "JSON_PATH_EQUALS"
          ? { bodyConditionPath: "$.service.states[0]" }
          : {}),
      }),
      fetchFn: async () => new Response(body, { status: 200 }),
    });
    expect(outcome.status).toBe("PASSED");
    expect(outcome.failureReason).toBeNull();
    expect(outcome.conditions.every((condition) => condition.passed)).toBe(true);
    expect(outcome.responseExcerpt).toBeNull();
  });

  it("requires all configured conditions to pass", async () => {
    const outcome = await run({
      config: config({
        bodyCondition: "CONTAINS",
        bodyExpectedValue: "healthy",
      }),
      fetchFn: async () => new Response("healthy", { status: 503 }),
    });
    expect(outcome).toMatchObject({
      status: "FAILED",
      failureReason: "UNEXPECTED_STATUS",
      conditions: [
        { type: "status", passed: false },
        { type: "body_contains", passed: true },
      ],
    });
  });

  it("returns BODY_MISMATCH for a false body comparison", async () => {
    await expect(
      run({
        config: config({
          bodyCondition: "EQUALS",
          bodyExpectedValue: "healthy",
        }),
        fetchFn: async () => new Response("failed", { status: 200 }),
      }),
    ).resolves.toMatchObject({ failureReason: "BODY_MISMATCH" });
  });

  it("distinguishes invalid JSON from a missing JSON path", async () => {
    const monitor = config({
      bodyCondition: "JSON_PATH_EQUALS",
      bodyExpectedValue: "ok",
      bodyConditionPath: "$.status.value",
    });
    await expect(
      run({
        config: monitor,
        fetchFn: async () => new Response("not-json", { status: 200 }),
      }),
    ).resolves.toMatchObject({ failureReason: "JSON_INVALID" });
    await expect(
      run({
        config: monitor,
        fetchFn: async () => new Response('{"status":{}}', { status: 200 }),
      }),
    ).resolves.toMatchObject({ failureReason: "JSON_PATH_MISSING" });
  });

  it("caps streamed body reads", async () => {
    const outcome = await run({
      config: config({
        bodyCondition: "CONTAINS",
        bodyExpectedValue: "needle",
      }),
      fetchFn: async () =>
        new Response("x".repeat(UPTIME_BODY_CAP + 1), { status: 200 }),
    });
    expect(outcome).toMatchObject({
      failureReason: "RESPONSE_TOO_LARGE",
      httpStatus: 200,
    });
    expect(outcome.responseExcerpt).toHaveLength(2_048);
  });

  it("substitutes allowed header secrets and redacts failed excerpts", async () => {
    const rawSecret = "raw-monitor-token";
    let authorization: string | null = null;
    const outcome = await run({
      config: config({
        headers: [{ key: "Authorization", value: "Bearer {{API_TOKEN}}" }],
        bodyCondition: "CONTAINS",
        bodyExpectedValue: "healthy",
      }),
      secrets: new Map([
        [
          "API_TOKEN",
          { value: rawSecret, allowedDomains: ["api.example.com"] },
        ],
      ]),
      fetchFn: async (_url, init) => {
        authorization = new Headers(init?.headers).get("Authorization");
        return new Response(
          `failed for ${rawSecret}; see https://logs.example.com/view?token=${rawSecret}&page=1`,
          { status: 200 },
        );
      },
    });
    expect(authorization).toBe(`Bearer ${rawSecret}`);
    expect(outcome.failureReason).toBe("BODY_MISMATCH");
    expect(outcome.responseExcerpt).toContain("{{API_TOKEN}}");
    expect(outcome.responseExcerpt).toContain("token=redacted");
    expect(JSON.stringify(outcome)).not.toContain(rawSecret);
  });
});
