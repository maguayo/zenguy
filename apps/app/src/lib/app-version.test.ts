import { describe, expect, it } from "@jest/globals";

import { compareVersions, isAppStoreUrl, isUpdateRequired, parseVersion } from "./app-version";

describe("app version checks", () => {
  it("parses dotted versions and rejects garbage", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion(" 2.0 ")).toEqual([2, 0, 0]);
    expect(parseVersion("v1.0.0")).toBeNull();
    expect(parseVersion("1.0.0-beta")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it("compares numerically, not lexically", () => {
    expect(compareVersions([1, 10, 0], [1, 9, 0])).toBeGreaterThan(0);
    expect(compareVersions([0, 1, 0], [0, 1, 0])).toBe(0);
    expect(compareVersions([0, 9, 9], [1, 0, 0])).toBeLessThan(0);
  });

  it("requires an update only when the installed build is older", () => {
    expect(isUpdateRequired("0.1.0", "0.2.0")).toBe(true);
    expect(isUpdateRequired("0.2.0", "0.2.0")).toBe(false);
    expect(isUpdateRequired("1.0.0", "0.9.9")).toBe(false);
    expect(isUpdateRequired("0.10.0", "0.9.0")).toBe(false);
  });

  it("fails open on unparseable versions", () => {
    expect(isUpdateRequired(undefined, "0.2.0")).toBe(false);
    expect(isUpdateRequired("0.1.0", "latest")).toBe(false);
  });

  it("accepts only https App Store links", () => {
    expect(isAppStoreUrl("https://apps.apple.com/app/zenguy/id123")).toBe(true);
    expect(isAppStoreUrl("http://apps.apple.com/app/id123")).toBe(false);
    expect(isAppStoreUrl("https://evil.example/apps.apple.com")).toBe(false);
    expect(isAppStoreUrl(null)).toBe(false);
  });
});
