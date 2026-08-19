import { describe, expect, it } from "vitest";

import {
  intervalOptions,
  retryOptionLabel,
  stagingCredentialsCopy,
  testFormSchema,
  timeoutHelpCopy,
  tokenNoteCopy,
} from "./TestFormPage";

const valid = {
  channelIds: [],
  device: "DESKTOP" as const,
  instructions: "Confirm the heading",
  intervalHours: 6,
  maxRetries: 2,
  name: "Smoke test",
  notifyOnRecovery: true,
  startUrl: "https://staging.example.com",
};

describe("browser test form", () => {
  it("mirrors the API validation limits", () => {
    expect(testFormSchema.safeParse(valid).success).toBe(true);
    expect(testFormSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(testFormSchema.safeParse({ ...valid, name: "x".repeat(121) }).success).toBe(false);
    expect(testFormSchema.safeParse({ ...valid, startUrl: "ftp://example.com" }).success).toBe(
      false,
    );
    expect(testFormSchema.safeParse({ ...valid, intervalHours: 25 }).success).toBe(false);
    expect(testFormSchema.safeParse({ ...valid, maxRetries: 4 }).success).toBe(false);
  });

  it("offers every hourly schedule and complete retry descriptions", () => {
    expect(intervalOptions).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(retryOptionLabel(3)).toBe(
      "3 retries — immediately, after 1 min, after 2 min",
    );
  });

  it("keeps the required safety and timeout copy verbatim", () => {
    expect(stagingCredentialsCopy).toBe(
      "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.",
    );
    expect(timeoutHelpCopy).toContain("Each attempt can run for up to 5 minutes.");
    expect(tokenNoteCopy).toContain("nominal maximum of 200,000 tokens");
  });
});
