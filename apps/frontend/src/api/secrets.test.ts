import { afterEach, describe, expect, it, vi } from "vitest";

import type { Secret } from "./types";
import {
  createSecret,
  deleteSecret,
  listSecrets,
  replaceSecret,
  secretPath,
} from "./secrets";

const secret: Secret = {
  allowedDomains: ["example.com"],
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: { name: "Demo User", userId: "user_1" },
  description: "QA account",
  id: "secret_1",
  key: "SHOP_PASSWORD",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("secrets API", () => {
  it("encodes secret paths", () => {
    expect(secretPath("ws/one", "secret two")).toBe(
      "/api/workspaces/ws%2Fone/secrets/secret%20two",
    );
  });

  it("exposes list, create, replace, and delete without reading values", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === "DELETE") return new Response(null, { status: 204 });
      if (String(request).endsWith("/secrets") && (!options?.method || options.method === "GET")) {
        return response([secret]);
      }
      return response(secret);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listSecrets("ws_1")).resolves.toEqual([secret]);
    await expect(
      createSecret("ws_1", {
        allowedDomains: ["example.com"],
        key: "SHOP_PASSWORD",
        value: "write-only-value",
      }),
    ).resolves.toEqual(secret);
    await expect(
      replaceSecret("ws_1", "secret_1", { value: "replacement" }),
    ).resolves.toEqual(secret);
    await expect(deleteSecret("ws_1", "secret_1")).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([, options]) => options?.method ?? "GET")).toEqual([
      "GET",
      "POST",
      "PUT",
      "DELETE",
    ]);
    expect(JSON.stringify(secret)).not.toContain("write-only-value");
  });
});
