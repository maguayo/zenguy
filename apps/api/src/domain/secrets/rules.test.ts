import {
  extractPlaceholders,
  isDomainAllowed,
  SECRET_KEY_REGEX,
  validateAllowedDomains,
} from "./rules";

describe("secret key rules", () => {
  it.each([
    "AB",
    "SHOP_EMAIL",
    "API_TOKEN_2",
    `A${"Z".repeat(63)}`,
  ])("accepts %s", (key) => {
    expect(SECRET_KEY_REGEX.test(key)).toBe(true);
  });

  it.each([
    "A",
    "_TOKEN",
    "2_TOKEN",
    "shop_email",
    "SHOP-EMAIL",
    "SHOP EMAIL",
    `A${"Z".repeat(64)}`,
  ])("rejects %s", (key) => {
    expect(SECRET_KEY_REGEX.test(key)).toBe(false);
  });
});

describe("allowed-domain rules", () => {
  it.each([
    [["example.com"]],
    [["shop.example.com", "api.example.co.uk"]],
    [["*.example.com"]],
    [Array.from({ length: 20 }, (_, index) => `host${index}.example.com`)],
  ])("accepts valid hostname entries", (domains) => {
    expect(() => validateAllowedDomains(domains)).not.toThrow();
  });

  it.each([
    [[]],
    [Array.from({ length: 21 }, (_, index) => `host${index}.example.com`)],
    [["localhost"]],
    [["Example.com"]],
    [["https://example.com"]],
    [["example.com/path"]],
    [["example.com:443"]],
    [[" example.com"]],
    [["*.com"]],
    [["*.*.example.com"]],
    [["-bad.example.com"]],
    [["bad-.example.com"]],
  ])("rejects invalid entries %j", (domains) => {
    expect(() => validateAllowedDomains(domains)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it.each([
    ["example.com", ["example.com"], true],
    ["www.example.com", ["example.com"], false],
    ["example.com", ["*.example.com"], true],
    ["a.example.com", ["*.example.com"], true],
    ["a.b.example.com", ["*.example.com"], true],
    ["A.B.Example.COM", ["*.EXAMPLE.com"], true],
    ["notexample.com", ["*.example.com"], false],
    ["example.com.evil.test", ["*.example.com"], false],
  ] as const)(
    "matches host %s against %j as %s",
    (host, allowed, expected) => {
      expect(isDomainAllowed(host, [...allowed])).toBe(expected);
    },
  );
});

describe("extractPlaceholders", () => {
  it("returns unique valid keys in first-seen order", () => {
    expect(
      extractPlaceholders(
        "Use {{SHOP_EMAIL}}, {{SHOP_PASSWORD}}, then {{SHOP_EMAIL}} again.",
      ),
    ).toEqual(["SHOP_EMAIL", "SHOP_PASSWORD"]);
  });

  it("ignores malformed, lowercase, and too-short placeholders", () => {
    expect(
      extractPlaceholders("{{A}} {{shop_email}} {{_TOKEN}} {{VALID_KEY}}"),
    ).toEqual(["VALID_KEY"]);
  });
});
