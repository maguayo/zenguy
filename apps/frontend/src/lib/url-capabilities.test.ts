import { describe, expect, it } from "vitest";

import {
  forgetPathCapability,
  parseUrlCapability,
  parseUrlCapabilityFragment,
  pathCapability,
  rememberPathCapability,
  withoutQueryParameter,
  withoutUrlCapability,
} from "./url-capabilities";

describe("URL capability redaction", () => {
  it("removes only the requested bearer and preserves other state", () => {
    expect(
      withoutQueryParameter(
        "https://app.zenguy.com/verify-email?token=secret&next=welcome#status",
        "token",
      ),
    ).toBe("/verify-email?next=welcome#status");
  });

  it("does not reflect credentials or cross-origin components", () => {
    expect(withoutQueryParameter("https://user:pass@evil.test/reset?token=x", "token")).toBe(
      "/reset",
    );
  });

  it("drops query and fragment capabilities from the visible replacement URL", () => {
    expect(
      withoutUrlCapability(
        "https://app.zenguy.com/verify-email?token=secret&next=welcome#private",
        "token",
      ),
    ).toBe("/verify-email?next=welcome");
    expect(
      withoutUrlCapability(
        "https://user:pass@evil.test/reset-password?token=secret#private",
        "token",
      ),
    ).toBe("/reset-password");
  });

  it("holds path bearers only in memory and expires them", () => {
    rememberPathCapability("/invitations/accept", "secret", 1_000);
    expect(pathCapability("/invitations/accept", 1_001)).toBe("secret");
    expect(pathCapability("/invitations/accept", 1_801_000)).toBe("");

    rememberPathCapability("/invitations/accept", "another", 2_000);
    forgetPathCapability("/invitations/accept");
    expect(pathCapability("/invitations/accept", 2_001)).toBe("");
  });

  it("accepts only bounded base64url-style bearer values", () => {
    expect(parseUrlCapability("  abc_123-Z  ")).toBe("abc_123-Z");
    expect(parseUrlCapability("../secret")).toBe("");
    expect(parseUrlCapability("a b")).toBe("");
    expect(parseUrlCapability("a".repeat(513))).toBe("");
    expect(parseUrlCapability(undefined)).toBe("");

    rememberPathCapability("/grants/redeem", "old", 3_000);
    rememberPathCapability("/grants/redeem", "../invalid", 3_001);
    expect(pathCapability("/grants/redeem", 3_002)).toBe("");
  });

  it("decodes fragment capabilities without accepting arbitrary fragments", () => {
    expect(parseUrlCapabilityFragment("#abc_123-Z")).toBe("abc_123-Z");
    expect(parseUrlCapabilityFragment("#token=abc%5F123-Z")).toBe("abc_123-Z");
    expect(parseUrlCapabilityFragment("#%E0%A4%A")).toBe("");
    expect(parseUrlCapabilityFragment("#section one")).toBe("");
  });
});
