import { isAppError, type ValidationDetail } from "../../shared/errors";
import {
  MAX_TRANSFER_BYTES,
  MAX_TRANSFER_TESTS,
  parseTestsFile,
  serializeTestsFile,
  type BrowserTestTransferEntry,
} from "./transfer";

function entry(
  overrides: Partial<BrowserTestTransferEntry> = {},
): BrowserTestTransferEntry {
  return {
    name: "Checkout",
    allowedDomains: [],
    writableDomains: [],
    testDataAttested: false,
    irreversibleActionScopes: [],
    startUrl: "https://shop.example.com/checkout",
    instructions: "Complete checkout and verify the confirmation",
    device: "DESKTOP",
    intervalHours: 6,
    maxRetries: 2,
    notifyOnRecovery: true,
    channelIds: ["ch_tests"],
    ...overrides,
  };
}

function detailsOf(text: string): ValidationDetail[] {
  try {
    parseTestsFile(text);
  } catch (error) {
    if (isAppError(error) && error.code === "VALIDATION_ERROR") {
      return error.details ?? [];
    }
    throw error;
  }
  throw new Error("expected parseTestsFile to reject the file");
}

describe("serializeTestsFile", () => {
  it("round-trips entries through YAML including multiline instructions", () => {
    const entries = [
      entry({
        id: "bt_one",
        instructions: "Open the cart\nAdd one item\nCheck the total",
      }),
      entry({ id: "bt_two", name: "Login", device: "MOBILE", channelIds: [] }),
    ];
    const text = serializeTestsFile(entries, "yaml");
    expect(text).toContain("version: 1");
    expect(parseTestsFile(text)).toEqual({ version: 1, tests: entries });
  });

  it("serializes JSON that parses back to the same file", () => {
    const entries = [entry({ id: "bt_one" })];
    const text = serializeTestsFile(entries, "json");
    expect(JSON.parse(text)).toEqual({ version: 1, tests: entries });
    expect(parseTestsFile(text)).toEqual({ version: 1, tests: entries });
  });
});

describe("parseTestsFile", () => {
  it("accepts entries without an id", () => {
    const text = serializeTestsFile([entry()], "yaml");
    expect(parseTestsFile(text).tests[0]).not.toHaveProperty("id");
  });

  it("rejects text that is not valid YAML or JSON", () => {
    expect(detailsOf("{ nope: [")).toEqual([
      { field: "file", message: expect.any(String) },
    ]);
  });

  it("rejects a document that is not an object", () => {
    expect(detailsOf("just a string")).toEqual([
      { field: "file", message: expect.any(String) },
    ]);
  });

  it("rejects unsupported versions", () => {
    const text = JSON.stringify({ version: 2, tests: [entry()] });
    expect(detailsOf(text)).toEqual([
      { field: "version", message: expect.any(String) },
    ]);
  });

  it("collects field errors for every invalid entry", () => {
    const text = JSON.stringify({
      version: 1,
      tests: [entry({ intervalHours: 99 }), entry({ startUrl: "not-a-url" })],
    });
    const details = detailsOf(text);
    expect(details.filter((detail) => detail.field === "tests.0.intervalHours"))
      .toEqual([{ field: "tests.0.intervalHours", message: expect.any(String) }]);
    expect(details.filter((detail) => detail.field === "tests.1.startUrl"))
      .toEqual([{ field: "tests.1.startUrl", message: expect.any(String) }]);
  });

  it("preserves cross-field writable-domain validation", () => {
    const text = JSON.stringify({
      version: 1,
      tests: [entry({ writableDomains: ["other.example.com"] })],
    });
    expect(detailsOf(text)).toEqual([
      {
        field: "tests.0.writableDomains.0",
        message:
          "Writable host must be the starting host or an explicitly allowed domain",
      },
    ]);
  });

  it("rejects entries with unknown keys", () => {
    const text = JSON.stringify({
      version: 1,
      tests: [{ ...entry(), internalHours: 6 }],
    });
    const fields = detailsOf(text).map((detail) => detail.field);
    expect(fields).toEqual(["tests.0"]);
  });

  it("rejects duplicate ids", () => {
    const text = JSON.stringify({
      version: 1,
      tests: [entry({ id: "bt_dup" }), entry({ id: "bt_dup" })],
    });
    expect(detailsOf(text)).toEqual([
      { field: "tests.1.id", message: expect.any(String) },
    ]);
  });

  it("rejects an empty tests list", () => {
    const text = JSON.stringify({ version: 1, tests: [] });
    expect(detailsOf(text)).toEqual([
      { field: "tests", message: expect.any(String) },
    ]);
  });

  it("rejects more tests than the limit", () => {
    const text = JSON.stringify({
      version: 1,
      tests: Array.from({ length: MAX_TRANSFER_TESTS + 1 }, () => entry()),
    });
    expect(detailsOf(text)).toEqual([
      { field: "tests", message: expect.any(String) },
    ]);
  });

  it("rejects files over the byte limit", () => {
    expect(detailsOf("a".repeat(MAX_TRANSFER_BYTES + 1))).toEqual([
      { field: "file", message: expect.any(String) },
    ]);
  });
});
