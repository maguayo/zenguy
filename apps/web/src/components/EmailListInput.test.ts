import { describe, expect, it } from "vitest";

import { addEmails } from "./EmailListInput";

describe("EmailListInput", () => {
  it("normalizes, splits, and deduplicates valid addresses", () => {
    expect(
      addEmails(["first@example.com"], " SECOND@example.com, first@example.com "),
    ).toEqual({
      emails: ["first@example.com", "second@example.com"],
      error: null,
    });
  });

  it("keeps the current list when an address is invalid", () => {
    expect(addEmails(["first@example.com"], "not-an-email")).toEqual({
      emails: ["first@example.com"],
      error: "“not-an-email” is not a valid email address.",
    });
  });

  it("enforces the ten-address limit", () => {
    const current = Array.from({ length: 10 }, (_, index) => `person${index}@example.com`);
    expect(addEmails(current, "extra@example.com")).toEqual({
      emails: current,
      error: "You can add up to 10 email addresses.",
    });
  });
});
