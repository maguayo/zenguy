import { buildApp } from "./app";
import { allowAdminAccess, fakeBindings } from "../test/fakes";
import { MAX_ADMIN_API_REQUEST_BODY_BYTES } from "./constants";

describe("admin app", () => {
  it("answers unknown API routes with a JSON 404 and security headers", async () => {
    const response = await buildApp(fakeBindings(), { accessVerifier: allowAdminAccess }).request(
      "/api/nope",
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  it("serves everything else from the assets binding with the same headers", async () => {
    const bindings = fakeBindings();
    const response = await buildApp(bindings, { accessVerifier: allowAdminAccess }).request(
      "/login",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>spa</html>");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });

  it("fails closed before assets or APIs when Access did not authenticate the request", async () => {
    const response = await buildApp(fakeBindings()).request("/login");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "FORBIDDEN", message: "Cloudflare Access required" },
    });
  });

  it("does not serialize raw internal errors into Workers logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await buildApp(fakeBindings(), {
      accessVerifier: {
        verify: async () => {
          throw new Error("private-token-in-error");
        },
      },
    }).request("/api/nope");

    expect(response.status).toBe(500);
    const output = String(log.mock.calls[0]?.[0]);
    expect(output).toContain('"event":"admin_unhandled_error"');
    expect(output).not.toContain("private-token-in-error");
    log.mockRestore();
  });

  it("counts and rejects an oversized API body when Content-Length is absent", async () => {
    const request = new Request("https://admin.zenguy.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"padding":"${"x".repeat(MAX_ADMIN_API_REQUEST_BODY_BYTES)}"}`,
    });
    expect(request.headers.get("Content-Length")).toBeNull();

    const response = await buildApp(fakeBindings(), {
      accessVerifier: allowAdminAccess,
    }).request(request);

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    });
  });

  it("does not trust an understated Content-Length", async () => {
    const request = new Request("https://admin.zenguy.test/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "1",
      },
      body: `{"padding":"${"x".repeat(MAX_ADMIN_API_REQUEST_BODY_BYTES)}"}`,
    });

    const response = await buildApp(fakeBindings(), {
      accessVerifier: allowAdminAccess,
    }).request(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    });
  });

  it("refuses to build without a canonical stable-id admin allowlist", () => {
    expect(() => buildApp(fakeBindings({ ADMIN_USER_IDS: "" }), { accessVerifier: allowAdminAccess })).toThrow(
      "ADMIN_USER_IDS must contain only",
    );
    expect(() => buildApp(fakeBindings({ ADMIN_USER_IDS: "   " }), { accessVerifier: allowAdminAccess })).toThrow(
      "ADMIN_USER_IDS must contain only",
    );
    expect(() =>
      buildApp(fakeBindings({ ADMIN_USER_IDS: "usr_seed_marcos" }), {
        accessVerifier: allowAdminAccess,
      }),
    ).toThrow("ADMIN_USER_IDS must contain only");
  });
});
