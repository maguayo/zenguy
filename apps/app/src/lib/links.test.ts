import { describe, expect, it } from "@jest/globals";

import { parseLinkToken, safeNextPath, workspaceHref } from "./links";

describe("parseLinkToken", () => {
  it("accepts base64url tokens and trims whitespace", () => {
    expect(parseLinkToken("abc_-1")).toBe("abc_-1");
    expect(parseLinkToken("  tok3n  ")).toBe("tok3n");
    expect(parseLinkToken(["first", "second"])).toBe("first");
  });

  it("rejects anything outside the expected alphabet or size", () => {
    expect(parseLinkToken("")).toBeNull();
    expect(parseLinkToken("a b")).toBeNull();
    expect(parseLinkToken("a".repeat(513))).toBeNull();
    expect(parseLinkToken("../etc")).toBeNull();
    expect(parseLinkToken(42)).toBeNull();
    expect(parseLinkToken(undefined)).toBeNull();
  });
});

describe("safeNextPath", () => {
  it("keeps in-app paths only", () => {
    expect(safeNextPath("/w/ws_1/tests")).toBe("/w/ws_1/tests");
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("/w/ws 1")).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});

describe("workspaceHref", () => {
  it("builds workspace routes with encoded ids", () => {
    expect(workspaceHref("ws_1")).toBe("/w/ws_1/overview");
    expect(workspaceHref("ws/1", "tests")).toBe("/w/ws%2F1/tests");
  });
});
