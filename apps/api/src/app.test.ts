import { z } from "zod";
import { buildApp } from "./app";
import { AppError } from "./shared/errors";
import { zjson, zquery } from "./http/validate";
import { fakeBindings } from "./test/fakes/bindings";

function testApp() {
  return buildApp(fakeBindings());
}

describe("HTTP kernel", () => {
  it("returns the health success envelope", async () => {
    const response = await testApp().request("/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { ok: true } });
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
    log.mockRestore();
  });

  it("sets request and security headers", async () => {
    const response = await testApp().request("/api/health");

    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f]{8}$/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
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
