import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  ApiError,
  absoluteArtifactUrl,
  apiGet,
  apiGetPage,
  apiGetText,
  apiPost,
  authEvents,
  beginTerminalLogout,
  clearSession,
  ensureFreshToken,
  filenameFromDisposition,
  hasStoredSession,
  SessionSupersededError,
  storeSession,
} from "./api";
import { getToken } from "./auth-token";
import { secureStorage, storageKeys } from "./secure-storage";

type FetchMock = jest.Mock<(input: string, init?: RequestInit) => Promise<Response>>;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...headers },
    status,
  });
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe("api client", () => {
  let fetchMock: FetchMock;

  beforeEach(async () => {
    fetchMock = jest.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    global.fetch = fetchMock as unknown as typeof fetch;
    await clearSession();
  });

  afterEach(async () => {
    await clearSession();
  });

  it("sends the bearer token and the native client header", async () => {
    await storeSession({ accessToken: "access-1", expiresIn: 1800, refreshToken: "refresh-1" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    await expect(apiGet("/api/health")).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:8787/api/health");
    expect(headerOf(init, "Authorization")).toBe("Bearer access-1");
    expect(headerOf(init, "X-Zenguy-Client")).toBe("native");
    expect(headerOf(init, "Content-Type")).toBeNull();
  });

  it("keeps the refresh token in secure storage only", async () => {
    await storeSession({ accessToken: "access-1", expiresIn: 1800, refreshToken: "refresh-1" });
    expect(await secureStorage.getItem(storageKeys.refreshToken)).toBe("refresh-1");
    expect(getToken().accessToken).toBe("access-1");
    expect(await hasStoredSession()).toBe(true);

    await clearSession();
    expect(await secureStorage.getItem(storageKeys.refreshToken)).toBeNull();
    expect(getToken().accessToken).toBeNull();
    expect(await hasStoredSession()).toBe(false);
  });

  it("refreshes with the stored token on 401 and retries once", async () => {
    await storeSession({ accessToken: "stale", expiresIn: 1800, refreshToken: "refresh-1" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            accessToken: "fresh",
            expiresIn: 1800,
            refreshExpiresIn: 2_592_000,
            refreshToken: "refresh-2",
            user: { id: "usr_1" },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "ws_1" }] }));

    await expect(apiGet("/api/workspaces")).resolves.toEqual([{ id: "ws_1" }]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] ?? [];
    expect(refreshUrl).toBe("http://127.0.0.1:8787/api/auth/refresh");
    expect(refreshInit?.method).toBe("POST");
    expect(JSON.parse(String(refreshInit?.body))).toEqual({ refreshToken: "refresh-1" });
    expect(headerOf(refreshInit, "X-Zenguy-Client")).toBe("native");
    const [, retryInit] = fetchMock.mock.calls[2] ?? [];
    expect(headerOf(retryInit, "Authorization")).toBe("Bearer fresh");
    expect(await secureStorage.getItem(storageKeys.refreshToken)).toBe("refresh-2");
  });

  it("signs out and wipes the Keychain when the refresh token is rejected", async () => {
    await storeSession({ accessToken: "stale", expiresIn: 1800, refreshToken: "refresh-1" });
    const signedOut = jest.fn();
    const unsubscribe = authEvents.onSignedOut(signedOut);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "UNAUTHORIZED", message: "Invalid or expired refresh token" } }, 401),
      );

    await expect(apiGet("/api/workspaces")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(await secureStorage.getItem(storageKeys.refreshToken)).toBeNull();
    expect(getToken().accessToken).toBeNull();
    unsubscribe();
  });

  it("keeps the session when the refresh fails for network reasons", async () => {
    await storeSession({ accessToken: "stale", expiresIn: 1800, refreshToken: "refresh-1" });
    const signedOut = jest.fn();
    const unsubscribe = authEvents.onSignedOut(signedOut);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401))
      .mockRejectedValueOnce(new TypeError("Network request failed"));

    await expect(apiGet("/api/workspaces")).rejects.toThrow("Network request failed");
    expect(signedOut).not.toHaveBeenCalled();
    expect(await secureStorage.getItem(storageKeys.refreshToken)).toBe("refresh-1");
    unsubscribe();
  });

  it("fails refresh immediately without a stored token", async () => {
    await expect(ensureFreshToken()).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares one refresh between concurrent 401s", async () => {
    await storeSession({ accessToken: "stale", expiresIn: 1800, refreshToken: "refresh-1" });
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith("/api/auth/refresh")) {
        return jsonResponse({
          data: {
            accessToken: "fresh",
            expiresIn: 1800,
            refreshExpiresIn: 1,
            refreshToken: "refresh-2",
            user: {},
          },
        });
      }
      return headerOf(init, "Authorization") === "Bearer fresh"
        ? jsonResponse({ data: { ok: true } })
        : jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401);
    });

    await Promise.all([apiGet("/api/a"), apiGet("/api/b")]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith("/api/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("aborts and discards a refresh that resolves after terminal logout", async () => {
    await storeSession({ accessToken: "principal-a", expiresIn: 1_800, refreshToken: "refresh-a" });
    let resolveRefresh: ((response: Response) => void) | undefined;
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementationOnce((_url, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      });
    });

    const pending = ensureFreshToken();
    while (fetchMock.mock.calls.length === 0) await Promise.resolve();
    await beginTerminalLogout();
    expect(signals[0]?.aborted).toBe(true);
    resolveRefresh?.(
      jsonResponse({
        data: {
          accessToken: "late-a",
          expiresIn: 1_800,
          refreshExpiresIn: 2_592_000,
          refreshToken: "late-refresh-a",
          user: { id: "usr_a" },
        },
      }),
    );

    await expect(pending).rejects.toBeInstanceOf(SessionSupersededError);
    expect(getToken().accessToken).toBeNull();
    expect(await secureStorage.getItem(storageKeys.refreshToken)).toBe("refresh-a");
  });

  it("unwraps pages and envelopes", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: "a" }], nextCursor: "cursor-2" }),
    );
    await expect(apiGetPage("/api/list")).resolves.toEqual({
      items: [{ id: "a" }],
      nextCursor: "cursor-2",
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiPost("/api/void", { a: 1 })).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(headerOf(init, "Content-Type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("turns error envelopes and non-JSON failures into ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "VALIDATION_ERROR", details: [{ field: "name", message: "Required" }], message: "Invalid request" } },
        400,
      ),
    );
    await expect(apiPost("/api/things", {})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ field: "name", message: "Required" }],
      message: "Invalid request",
      status: 400,
    });

    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    const error = await apiGet("/api/things").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "INTERNAL", message: "Request failed", status: 502 });
  });

  it("rejects paths outside /api/", async () => {
    await expect(apiGet("/not-api")).rejects.toThrow("API paths must start with /api/");
  });

  it("downloads text with the server-provided filename", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("# Report", {
        headers: {
          "Content-Disposition": "attachment; filename=\"run-report.md\"",
          "Content-Type": "text/markdown; charset=utf-8",
        },
        status: 200,
      }),
    );
    await expect(apiGetText("/api/report")).resolves.toEqual({
      filename: "run-report.md",
      mimeType: "text/markdown",
      text: "# Report",
    });
  });

  it("parses content-disposition variants", () => {
    expect(filenameFromDisposition(null)).toBe("download");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''caf%C3%A9.md")).toBe("café.md");
    expect(filenameFromDisposition("attachment; filename=plain.yaml")).toBe("plain.yaml");
  });

  it("prefixes relative artifact urls with the API origin", () => {
    expect(absoluteArtifactUrl("/api/artifact-content?id=1")).toBe(
      "http://127.0.0.1:8787/api/artifact-content?id=1",
    );
    expect(absoluteArtifactUrl("https://cdn.example/x.png")).toBe("https://cdn.example/x.png");
  });
});
