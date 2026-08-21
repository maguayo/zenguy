import { describe, expect, it } from "@jest/globals";

import { addDomains, isAllowedDomain, removeDomain } from "./domains";

describe("DomainListInput helpers", () => {
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
    expect(addDomains(["example.com"], "  ,  ")).toEqual({
      domains: ["example.com"],
      error: null,
    });
  });

  it("keeps the existing value for invalid or over-limit input", () => {
    expect(addDomains(["example.com"], "https://example.com")).toEqual({
      domains: ["example.com"],
      error: "“https://example.com” must be a hostname or wildcard such as *.example.com.",
    });
    const current = Array.from({ length: 20 }, (_, index) => `host${index}.example.com`);
    expect(addDomains(current, "extra.example.com")).toEqual({
      domains: current,
      error: "You can add up to 20 allowed domains.",
    });
  });

  it("removes a single domain without touching the others", () => {
    expect(removeDomain(["a.example.com", "b.example.com"], "a.example.com")).toEqual([
      "b.example.com",
    ]);
    expect(removeDomain(["a.example.com"], "missing.example.com")).toEqual(["a.example.com"]);
  });
});
