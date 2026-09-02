import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REMOTE_AI_CONSENT_VERSION,
  getRemoteAiConsent,
  grantRemoteAiConsent,
  remoteAiConsentPath,
  remoteAiConsentQueryKey,
  revokeRemoteAiConsent,
} from "./remote_ai_consent";
import type { RemoteAiConsentStatus } from "./types";

const status: RemoteAiConsentStatus = {
  acceptedAt: "2026-09-02T06:17:13.000Z",
  active: true,
  policyVersion: REMOTE_AI_CONSENT_VERSION,
  provider: "OpenAI",
  revokedAt: null,
};

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("remote AI consent API", () => {
  it("encodes the workspace path and scopes the query key to the workspace", () => {
    expect(remoteAiConsentPath("ws/one")).toBe(
      "/api/workspaces/ws%2Fone/remote-ai-consent",
    );
    expect(remoteAiConsentQueryKey("ws_1")).toEqual(["ws", "ws_1", "remote-ai-consent"]);
  });

  it("reads, grants with the current policy version, and revokes", async () => {
    const fetchMock = vi.fn(async (_request: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === "DELETE") return new Response(null, { status: 204 });
      return response(status);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getRemoteAiConsent("ws_1")).resolves.toEqual(status);
    await expect(grantRemoteAiConsent("ws_1")).resolves.toEqual(status);
    await expect(revokeRemoteAiConsent("ws_1")).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([, options]) => options?.method ?? "GET")).toEqual([
      "GET",
      "PUT",
      "DELETE",
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/workspaces/ws_1/remote-ai-consent",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      consent: true,
      policyVersion: REMOTE_AI_CONSENT_VERSION,
    });
  });
});
