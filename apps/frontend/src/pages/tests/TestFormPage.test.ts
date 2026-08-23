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
  allowedDomains: ["checkout.example.com", "*.login.example.com"],
  writableDomains: ["staging.example.com", "checkout.example.com"],
  testDataAttested: false,
  irreversibleActionScopesJson: "[]",
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
    expect(
      testFormSchema.safeParse({ ...valid, allowedDomains: ["https://example.com"] }).success,
    ).toBe(false);
    expect(
      testFormSchema.safeParse({ ...valid, allowedDomains: ["EXAMPLE.com"] }).success,
    ).toBe(false);
    expect(
      testFormSchema.safeParse({ ...valid, writableDomains: ["*.example.com"] }).success,
    ).toBe(false);
    expect(
      testFormSchema.safeParse({ ...valid, writableDomains: ["other.example.net"] }).success,
    ).toBe(false);
  });

  it("offers every hourly schedule and complete retry descriptions", () => {
    expect(intervalOptions).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(retryOptionLabel(3)).toBe(
      "3 retries — immediately, after 1 min, after 2 min",
    );
  });

  it("requires explicit staging attestation for irreversible scopes", () => {
    const irreversibleActionScopesJson = JSON.stringify([
      {
        kind: "HTTP",
        method: "POST",
        origin: "https://staging.example.com",
        path: "/orders",
        maxUses: 1,
      },
    ]);
    expect(
      testFormSchema.safeParse({ ...valid, irreversibleActionScopesJson }).success,
    ).toBe(false);
    expect(
      testFormSchema.safeParse({
        ...valid,
        testDataAttested: true,
        irreversibleActionScopesJson,
      }).success,
    ).toBe(true);
  });

  it("rejects legacy DOM scopes without a signed submit/form identity", () => {
    const legacyDomScope = {
      kind: "DOM",
      action: "CLICK",
      origin: "https://staging.example.com",
      path: "/checkout",
      target: { attribute: "data-testid", value: "place-order" },
      maxUses: 1,
    };
    const hardenedDomScope = {
      ...legacyDomScope,
      target: {
        ...legacyDomScope.target,
        tag: "BUTTON",
        type: "submit",
        form: {
          method: "POST",
          origin: "https://staging.example.com",
          path: "/orders",
        },
      },
    };
    const httpScope = {
      kind: "HTTP",
      method: "POST",
      origin: "https://staging.example.com",
      path: "/orders",
      maxUses: 1,
    };
    expect(
      testFormSchema.safeParse({
        ...valid,
        testDataAttested: true,
        irreversibleActionScopesJson: JSON.stringify([legacyDomScope, httpScope]),
      }).success,
    ).toBe(false);
    expect(
      testFormSchema.safeParse({
        ...valid,
        testDataAttested: true,
        irreversibleActionScopesJson: JSON.stringify([hardenedDomScope, httpScope]),
      }).success,
    ).toBe(true);
  });

  it("keeps the required safety and timeout copy verbatim", () => {
    expect(stagingCredentialsCopy).toBe(
      "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.",
    );
    expect(timeoutHelpCopy).toContain("Each attempt can run for up to 5 minutes.");
    expect(tokenNoteCopy).toContain("nominal maximum of 200,000 tokens");
  });
});
