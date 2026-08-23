import { buildApp } from "./app";
import { fakeBindings } from "../test/fakes";

describe("admin app", () => {
  it("answers unknown API routes with a JSON 404 and security headers", async () => {
    const response = await buildApp(fakeBindings()).request("/api/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  it("serves everything else from the assets binding with the same headers", async () => {
    const bindings = fakeBindings();
    const response = await buildApp(bindings).request("/login");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>spa</html>");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
