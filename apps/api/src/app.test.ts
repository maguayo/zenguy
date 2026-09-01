import { z } from "zod";
import { buildApp } from "./app";
import { AppError } from "./shared/errors";
import { zjson, zquery } from "./http/validate";
import { fakeBindings } from "./test/fakes/bindings";
import {
  MAX_API_REQUEST_BODY_BYTES,
  MAX_BROWSER_TEST_IMPORT_BODY_BYTES,
  MAX_STANDARD_API_REQUEST_BODY_BYTES,
} from "./shared/constants";

function testApp() {
  return buildApp(fakeBindings());
}

describe("HTTP kernel", () => {
  it("returns the health success envelope", async () => {
    const response = await testApp().request("/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { ok: true, environment: "development", runnerDispatch: "queue" },
    });
  });

  it("boots with SMS and voice when Paddle and WhatsApp are disabled", async () => {
    const env = fakeBindings();
    delete env.TWILIO_FROM_WHATSAPP;
    delete env.PADDLE_API_KEY;
    delete env.PADDLE_WEBHOOK_SECRET;
    delete env.PADDLE_CLIENT_TOKEN;
    delete env.PADDLE_PRODUCT_ID;
    delete env.PADDLE_PRICE_ID;
    delete env.PADDLE_OVERAGE_PRICE_ID;
    const app = buildApp(env);

    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    const paddleWebhook = await app.request("/api/webhooks/paddle", {
      method: "POST",
    });
    expect(paddleWebhook.status).toBe(404);
  });

  it("formats unhandled errors without exposing internals", async () => {
    const app = testApp();
    app.get("/api/_boom", () => {
      throw new Error("database internals");
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await app.request("/api/_boom");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL", message: "Internal error" },
    });
    expect(log).toHaveBeenCalledOnce();
    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('"event":"unhandled_error"');
    expect(logged).toContain('"path":"/api/_boom"');
    expect(logged).not.toContain("database internals");
    log.mockRestore();
  });

  it("sets request and security headers", async () => {
    const response = await testApp().request("/api/health");

    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f]{8}$/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("counts and rejects an oversized body when Content-Length is absent", async () => {
    const app = testApp();
    app.post("/api/_body", async (context) => {
      await context.req.text();
      return context.json({ data: { parsed: true } });
    });
    const request = new Request("http://localhost/api/_body", {
      method: "POST",
      body: "x".repeat(MAX_STANDARD_API_REQUEST_BODY_BYTES + 1),
    });
    expect(request.headers.get("Content-Length")).toBeNull();

    const response = await app.request(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    });
  });

  it("counts the stream even when Content-Length understates the body", async () => {
    const app = testApp();
    app.post("/api/_body", async (context) => {
      await context.req.text();
      return context.json({ data: { parsed: true } });
    });
    const request = new Request("http://localhost/api/_body", {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: "x".repeat(MAX_STANDARD_API_REQUEST_BODY_BYTES + 1),
    });

    const response = await app.request(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    });
  });

  it("uses larger caps only for imports and runner screenshot steps", async () => {
    const app = testApp();
    const importPath = "/api/workspaces/ws_1/browser-tests/import";
    const runnerPath = "/api/runner/attempts/att_1/steps";
    const mediumBody = "x".repeat(MAX_STANDARD_API_REQUEST_BODY_BYTES + 1);

    const acceptedByImportCap = await app.request(importPath, {
      method: "POST",
      body: mediumBody,
    });
    expect(acceptedByImportCap.status).not.toBe(413);

    const acceptedByRunnerCap = await app.request(runnerPath, {
      method: "POST",
      body: mediumBody,
    });
    expect(acceptedByRunnerCap.status).not.toBe(413);

    const importResponse = await app.request(importPath, {
      method: "POST",
      body: "x".repeat(MAX_BROWSER_TEST_IMPORT_BODY_BYTES + 1),
    });
    expect(importResponse.status).toBe(413);

    const runnerResponse = await app.request(runnerPath, {
      method: "POST",
      body: "x".repeat(MAX_API_REQUEST_BODY_BYTES + 1),
    });
    expect(runnerResponse.status).toBe(413);

    const lookalike = await app.request(`${runnerPath}/extra`, {
      method: "POST",
      body: "x".repeat(MAX_STANDARD_API_REQUEST_BODY_BYTES + 1),
    });
    expect(lookalike.status).toBe(413);
  });

  it("serializes application errors and retry timing", async () => {
    const app = testApp();
    app.get("/api/_limited", () => {
      throw new AppError(
        "RATE_LIMITED",
        "Too many requests",
        undefined,
        12,
      );
    });

    const response = await app.request("/api/_limited");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    await expect(response.json()).resolves.toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
  });

  it("returns JSON 404 for an unknown API path", async () => {
    const response = await testApp().request("/api/missing");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  it("converts zod JSON and query failures into field details", async () => {
    const app = testApp();
    app.post(
      "/api/_validate",
      zjson(z.object({ name: z.string().min(1) })),
      zquery(z.object({ mode: z.enum(["safe"]) })),
      (context) => context.json({ data: context.req.valid("json") }),
    );

    const response = await app.request("/api/_validate?mode=safe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: [
          {
            field: "name",
            message: "Too small: expected string to have >=1 characters",
          },
        ],
      },
    });

    const queryResponse = await app.request("/api/_validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "valid" }),
    });
    expect(queryResponse.status).toBe(400);
    await expect(queryResponse.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: [{ field: "mode" }],
      },
    });
  });
});
