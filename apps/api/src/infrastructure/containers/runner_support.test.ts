import { describe, expect, it, vi } from "vitest";
import {
  buildRunnerEnvVars,
  parseDispatchPayload,
  runnerWorkerId,
  watchdogClaim,
  type RunnerContainerEnv,
} from "./runner_support";
import type { AttemptMessage } from "../../domain/queues";

const env: RunnerContainerEnv = {
  RUNNER_ENVIRONMENT: "staging",
  PUBLIC_API_URL: "https://staging-app.zenguy.com",
  RUNNER_CF_API_TOKEN: "t".repeat(48),
  OPENAI_API_KEY_CF: "sk-test",
  RUNNER_CF_ACCESS_CLIENT_ID: "c".repeat(32),
  RUNNER_CF_ACCESS_CLIENT_SECRET: "s".repeat(48),
};

const message = { attemptId: "att_1" } as AttemptMessage;

describe("buildRunnerEnvVars", () => {
  it("compone el entorno one-shot del contenedor", () => {
    const vars = buildRunnerEnvVars(env, message, "cf-abc");
    expect(vars.ZENGUY_ISOLATED_RUNNER).toBe("cloudflare");
    expect(vars.ZENGUY_RUNNER_ENVIRONMENT).toBe("staging");
    expect(vars.ZENGUY_WORKER_ID).toBe("zenguy-staging-cf");
    expect(vars.ZENGUY_API_URL).toBe("https://staging-app.zenguy.com");
    expect(vars.ZENGUY_DELIVERY_ID).toBe("cf-abc");
    expect(JSON.parse(vars.ZENGUY_ATTEMPT_MESSAGE).attemptId).toBe("att_1");
    expect(vars.ZENGUY_RUNNER_TOKEN).toBe(env.RUNNER_CF_API_TOKEN);
    expect(vars.OPENAI_API_KEY).toBe("sk-test");
    expect(vars.CF_ACCESS_CLIENT_ID).toBe(env.RUNNER_CF_ACCESS_CLIENT_ID);
  });

  it("rechaza un entorno sin secretos", () => {
    expect(() =>
      buildRunnerEnvVars({ ...env, RUNNER_CF_API_TOKEN: "" }, message, "d"),
    ).toThrow(/secretos/);
  });
});

describe("runnerWorkerId", () => {
  it("deriva la identidad del entorno", () => {
    expect(runnerWorkerId("production")).toBe("zenguy-production-cf");
  });
});

describe("parseDispatchPayload", () => {
  it("acepta message con delay y lo normaliza a entero no negativo", () => {
    expect(
      parseDispatchPayload({ message: { attemptId: "a" }, delaySeconds: 60.9 }),
    ).toEqual({ message: { attemptId: "a" }, delaySeconds: 60 });
    expect(
      parseDispatchPayload({ message: { attemptId: "a" }, delaySeconds: -5 }),
    ).toEqual({ message: { attemptId: "a" }, delaySeconds: 0 });
    expect(parseDispatchPayload({ message: { attemptId: "a" } })).toEqual({
      message: { attemptId: "a" },
      delaySeconds: 0,
    });
  });

  it("rechaza payloads sin attemptId", () => {
    expect(parseDispatchPayload(null)).toBeNull();
    expect(parseDispatchPayload({})).toBeNull();
    expect(parseDispatchPayload({ message: { attemptId: "" } })).toBeNull();
    expect(parseDispatchPayload({ message: "att_1" })).toBeNull();
  });
});

describe("watchdogClaim", () => {
  const jsonResponse = (disposition: string) =>
    new Response(JSON.stringify({ data: { disposition } }), { status: 200 });

  it("hace el claim con la identidad y credenciales cf", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("SKIP"));
    const result = await watchdogClaim(env, message, "cf-w1", fetchImpl as never);
    expect(result).toBe("SKIP");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://staging-app.zenguy.com/api/runner/attempts/claim",
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${env.RUNNER_CF_API_TOKEN}`);
    expect(headers["X-Zenguy-Worker-Id"]).toBe("zenguy-staging-cf");
    expect(headers["CF-Access-Client-Id"]).toBe(env.RUNNER_CF_ACCESS_CLIENT_ID);
    expect(JSON.parse(init.body as string)).toEqual({
      deliveryId: "cf-w1",
      message: { attemptId: "att_1" },
      workerId: "zenguy-staging-cf",
    });
  });

  it("devuelve EXECUTE cuando la API lo dispone", async () => {
    const result = await watchdogClaim(
      env,
      message,
      "cf-w2",
      (async () => jsonResponse("EXECUTE")) as never,
    );
    expect(result).toBe("EXECUTE");
  });

  it("mapea 401/403 a AUTH_ERROR", async () => {
    const result = await watchdogClaim(
      env,
      message,
      "cf-w3",
      (async () => new Response(null, { status: 401 })) as never,
    );
    expect(result).toBe("AUTH_ERROR");
  });

  it("trata errores 5xx y JSON inválido como transitorios (null)", async () => {
    expect(
      await watchdogClaim(
        env,
        message,
        "cf-w4",
        (async () => new Response(null, { status: 503 })) as never,
      ),
    ).toBeNull();
    expect(
      await watchdogClaim(
        env,
        message,
        "cf-w5",
        (async () => new Response("no-json", { status: 200 })) as never,
      ),
    ).toBeNull();
  });
});
