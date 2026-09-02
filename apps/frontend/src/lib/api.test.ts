import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToken, getToken, setToken } from "./auth-token";
import {
  ApiError,
  apiGet,
  apiGetBlob,
  apiGetPage,
  apiPost,
  authEvents,
  confirmTerminalLogout,
  ensureFreshToken,
  REFRESH_LOCK_NAME,
  SessionSupersededError,
  supersedeSession,
} from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("API client", () => {
  beforeEach(() => {
    confirmTerminalLogout();
    supersedeSession();
    clearToken();
  });

  afterEach(() => {
    confirmTerminalLogout();
    supersedeSession();
    clearToken();
    vi.unstubAllGlobals();
  });

  it("unwraps success envelopes and sends credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("prefixes requests with VITE_API_ORIGIN when configured", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_ORIGIN", "https://api-staging.zenguy.com/");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    const fresh = await import("./api");
    await expect(fresh.apiGet<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
    expect(fresh.apiUrl("/api/auth/google/start")).toBe(
      "https://api-staging.zenguy.com/api/auth/google/start",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-staging.zenguy.com/api/health",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("preserves paginated cursors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ data: [{ id: "one" }], nextCursor: "cursor-2" }),
      ),
    );

    await expect(apiGetPage<{ id: string }>("/api/items")).resolves.toEqual({
      items: [{ id: "one" }],
      nextCursor: "cursor-2",
    });
  });

  it("throws ApiError with envelope fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              details: [{ field: "email", message: "Invalid email" }],
              message: "Invalid input",
            },
          },
          400,
        ),
      ),
    );

    const error = await apiPost("/api/items", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ field: "email", message: "Invalid email" }],
      message: "Invalid input",
      status: 400,
    });
  });

  it("refreshes a 401 and retries the original request exactly once", async () => {
    setToken("expired", 1_800);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ data: { accessToken: "fresh", expiresIn: 1_800, user: {} } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { value: 42 } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet<{ value: number }>("/api/protected")).resolves.toEqual({ value: 42 });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/protected",
      "/api/auth/refresh",
      "/api/protected",
    ]);
    const retriedHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Headers;
    expect(retriedHeaders.get("Authorization")).toBe("Bearer fresh");
  });

  it("uses one refresh request for concurrent 401 responses", async () => {
    let protectedCalls = 0;
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === "/api/auth/refresh") {
        refreshCalls += 1;
        return jsonResponse({ data: { accessToken: "fresh", expiresIn: 1_800, user: {} } });
      }
      protectedCalls += 1;
      if (protectedCalls <= 2) {
        return jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401);
      }
      return jsonResponse({ data: { path } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      apiGet<{ path: string }>("/api/first"),
      apiGet<{ path: string }>("/api/second"),
    ]);

    expect(first.path).toBe("/api/first");
    expect(second.path).toBe("/api/second");
    expect(refreshCalls).toBe(1);
  });

  it("serialises refreshes across tabs through the Web Locks API", async () => {
    setToken("stale", 1_800);
    let runLocked: (() => void) | undefined;
    const request = vi.fn(
      (name: string, callback: () => Promise<unknown>) =>
        new Promise((resolve, reject) => {
          runLocked = () => callback().then(resolve, reject);
          void name;
        }),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { accessToken: "fresh", expiresIn: 1_800, user: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = ensureFreshToken();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith(REFRESH_LOCK_NAME, expect.any(Function));
    expect(fetchMock).not.toHaveBeenCalled();

    runLocked?.();
    await expect(pending).resolves.toMatchObject({ accessToken: "fresh" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getToken().accessToken).toBe("fresh");
  });

  it("does not refresh under a lock acquired after the session was superseded", async () => {
    setToken("stale", 1_800);
    let runLocked: (() => void) | undefined;
    vi.stubGlobal("navigator", {
      locks: {
        request: (_name: string, callback: () => Promise<unknown>) =>
          new Promise((resolve, reject) => {
            runLocked = () => callback().then(resolve, reject);
          }),
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const pending = ensureFreshToken();
    await Promise.resolve();
    supersedeSession();
    runLocked?.();

    await expect(pending).rejects.toBeInstanceOf(SessionSupersededError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts and discards a refresh response from a superseded session", async () => {
    setToken("principal-a", 1_800);
    let resolveRefresh: ((response: Response) => void) | undefined;
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }),
    );

    const pending = ensureFreshToken();
    await Promise.resolve();
    supersedeSession();
    expect(signals[0]?.aborted).toBe(true);
    resolveRefresh?.(
      jsonResponse({ data: { accessToken: "late-a", expiresIn: 1_800, user: {} } }),
    );

    await expect(pending).rejects.toBeInstanceOf(SessionSupersededError);
    expect(getToken().accessToken).toBeNull();
  });

  it("clears auth and emits signed-out when refresh fails", async () => {
    setToken("expired", 1_800);
    const onSignedOut = vi.fn();
    const unsubscribe = authEvents.onSignedOut(onSignedOut);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401))
        .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401)),
    );

    await expect(apiGet("/api/protected")).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toEqual({ accessToken: null, expiresAt: null });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not refresh a login 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "INVALID_CREDENTIALS" } }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiPost("/api/auth/login", {})).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downloads blobs and parses UTF-8 filenames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("report", {
          headers: {
            "Content-Disposition": "attachment; filename*=UTF-8''failure%20report.md",
            "Content-Type": "text/markdown",
          },
        }),
      ),
    );

    const result = await apiGetBlob("/api/report");
    expect(result.filename).toBe("failure report.md");
    await expect(result.blob.text()).resolves.toBe("report");
  });
});
