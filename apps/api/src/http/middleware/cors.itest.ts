import { describe, expect, it } from "vitest";

import { buildApp } from "../../app";
import { testEnv } from "../../test/helpers";

describe("CORS for the app origin", () => {
  it("allows the configured app origin with credentials", async () => {
    const app = buildApp(testEnv());
    const response = await app.request("/api/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("answers preflight requests for auth routes", async () => {
    const app = buildApp(testEnv());
    const response = await app.request("/api/auth/refresh", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(response.headers.get("Access-Control-Allow-Headers") ?? "").toMatch(/authorization/i);
  });

  it("exposes Content-Disposition so downloads keep their filename", async () => {
    const app = buildApp(testEnv());
    const response = await app.request("/api/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(response.headers.get("Access-Control-Expose-Headers") ?? "").toMatch(
      /content-disposition/i,
    );
  });

  it("does not allow other origins", async () => {
    const app = buildApp(testEnv());
    const response = await app.request("/api/health", {
      headers: { Origin: "https://evil.example" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
