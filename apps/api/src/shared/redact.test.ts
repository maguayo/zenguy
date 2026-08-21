import {
  Redactor,
  sanitizeAuditMetadata,
  sanitizeHeaders,
  sanitizeUrl,
  truncate,
} from "./redact";

describe("Redactor", () => {
  it("redacts literal and URL-encoded values in one string", () => {
    const redactor = new Redactor([
      { key: "PASSWORD", value: "very secret!" },
    ]);

    expect(
      redactor.redact(
        "literal=very secret! encoded=very%20secret! form=very+secret%21 unchanged=public",
      ),
    ).toBe(
      "literal={{PASSWORD}} encoded={{PASSWORD}} form={{PASSWORD}} unchanged=public",
    );
  });

  it("replaces longer overlapping values first and ignores empty secrets", () => {
    const redactor = new Redactor([
      { key: "SHORT", value: "token" },
      { key: "LONG", value: "token-extended" },
      { key: "EMPTY", value: "" },
    ]);

    expect(redactor.redact("token-extended token remains")).toBe(
      "{{LONG}} {{SHORT}} remains",
    );
  });

  it("redacts nested arrays and objects without mutating the input", () => {
    const input = {
      message: "secret-value",
      nested: [{ url: "https://example.com/?q=secret-value" }],
      count: 2,
    };
    const redactor = new Redactor([{ key: "TOKEN", value: "secret-value" }]);

    const output = redactor.redactDeep(input);

    expect(output).toEqual({
      message: "{{TOKEN}}",
      nested: [{ url: "https://example.com/?q={{TOKEN}}" }],
      count: 2,
    });
    expect(input.message).toBe("secret-value");
  });

  it("returns empty text for nullish input", () => {
    const redactor = new Redactor([]);

    expect(redactor.redact(null)).toBe("");
    expect(redactor.redact(undefined)).toBe("");
  });
});

describe("sanitizeUrl", () => {
  it.each([
    [
      "https://example.com/path?token=abc&safe=yes#fragment",
      "https://example.com/path?token=redacted&safe=yes",
    ],
    [
      "https://user:password@example.com/login?return=%2Fdashboard",
      "https://example.com/login?return=%2Fdashboard",
    ],
    [
      "https://example.com/?apiKey=one&session_id=two&query=three",
      "https://example.com/?apiKey=redacted&session_id=redacted&query=three",
    ],
    ["https://example.com/path", "https://example.com/path"],
    ["not a URL", "<invalid-url>"],
  ])("sanitizes %s", (raw, expected) => {
    expect(sanitizeUrl(raw)).toBe(expected);
  });

  it("keeps duplicate safe query parameters", () => {
    expect(sanitizeUrl("https://example.com/?tag=a&tag=b")).toBe(
      "https://example.com/?tag=a&tag=b",
    );
  });
});

describe("sanitizeHeaders", () => {
  it("drops cookies, masks authorization headers, and keeps safe headers", () => {
    expect(
      sanitizeHeaders({
        Authorization: "Bearer secret",
        "X-Api-Key": "key",
        "Proxy-Authorization": "Basic secret",
        Cookie: "session=secret",
        "Set-Cookie": "session=secret",
        Accept: "application/json",
      }),
    ).toEqual({
      Authorization: "***",
      "X-Api-Key": "***",
      "Proxy-Authorization": "***",
      Accept: "application/json",
    });
  });
});

describe("sanitizeAuditMetadata", () => {
  it("keeps public resource keys but masks credential-bearing key fields", () => {
    expect(
      sanitizeAuditMetadata({
        key: "SHOP_PASSWORD",
        apiKey: "provider-secret",
        password: "account-secret",
      }),
    ).toEqual({
      key: "SHOP_PASSWORD",
      apiKey: "***",
      password: "***",
    });
  });
});

describe("truncate", () => {
  it("keeps short strings and appends an ellipsis within the limit", () => {
    expect(truncate("short", 5)).toBe("short");
    expect(truncate("abcdef", 5)).toBe("abcd…");
    expect(truncate("abcdef", 1)).toBe("…");
    expect(truncate("abcdef", 0)).toBe("");
  });
});
