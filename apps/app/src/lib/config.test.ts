import { describe, expect, it } from "@jest/globals";

import { resolveApiOrigin } from "./config";

describe("resolveApiOrigin", () => {
  it("strips trailing slashes and keeps https origins", () => {
    expect(resolveApiOrigin("https://api.zenguy.com/", false)).toBe("https://api.zenguy.com");
    expect(resolveApiOrigin("  https://api-staging.zenguy.com ", false)).toBe(
      "https://api-staging.zenguy.com",
    );
  });

  it("defaults to the local Wrangler API in development and production otherwise", () => {
    expect(resolveApiOrigin(undefined, true)).toBe("http://127.0.0.1:8787");
    expect(resolveApiOrigin("", false)).toBe("https://api.zenguy.com");
  });

  it("refuses cleartext origins outside local development", () => {
    expect(() => resolveApiOrigin("http://api.zenguy.com", false)).toThrow(/https/u);
    expect(() => resolveApiOrigin("http://127.0.0.1:8787", false)).toThrow(/https/u);
    expect(resolveApiOrigin("http://192.168.1.20:8787", true)).toBe("http://192.168.1.20:8787");
    expect(() => resolveApiOrigin("http://evil.example", true)).toThrow(/https/u);
  });

  it("refuses origins with paths or invalid URLs", () => {
    expect(() => resolveApiOrigin("https://api.zenguy.com/api", false)).toThrow(/path/u);
    expect(() => resolveApiOrigin("not a url", false)).toThrow(/valid URL/u);
  });
});
