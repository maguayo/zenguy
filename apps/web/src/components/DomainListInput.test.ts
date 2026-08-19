import { describe, expect, it } from "vitest";

import { addDomains, isAllowedDomain } from "./DomainListInput";

describe("DomainListInput", () => {
  it("accepts hostnames and wildcards while rejecting URLs and invalid labels", () => {
    expect(isAllowedDomain("example.com")).toBe(true);
    expect(isAllowedDomain("*.staging.example.com")).toBe(true);
    expect(isAllowedDomain("https://example.com")).toBe(false);
    expect(isAllowedDomain("localhost")).toBe(false);
    expect(isAllowedDomain("-bad.example.com")).toBe(false);
  });

  it("lowercases, splits, and deduplicates domains", () => {
    expect(addDomains(["example.com"], " *.EXAMPLE.com, example.com ")).toEqual({
      domains: ["example.com", "*.example.com"],
      error: null,
    });
  });

  it("keeps the existing value for invalid or over-limit input", () => {
    expect(addDomains(["example.com"], "https://example.com").domains).toEqual([
      "example.com",
    ]);
    const current = Array.from({ length: 20 }, (_, index) => `host${index}.example.com`);
    expect(addDomains(current, "extra.example.com")).toEqual({
      domains: current,
      error: "You can add up to 20 allowed domains.",
    });
  });
});
