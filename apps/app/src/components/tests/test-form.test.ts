import { describe, expect, it } from "@jest/globals";

import type { BrowserTest, Channel } from "@/api/types";
import {
  defaultChannelIds,
  intervalOptionLabel,
  intervalOptions,
  isTestFormField,
  retryOptionLabel,
  retryOptions,
  stagingCredentialsCopy,
  testFormDefaults,
  testFormSchema,
  testFormValues,
  timeoutHelpCopy,
  tokenNoteCopy,
} from "./test-form";

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

function channel(id: string, overrides: Partial<Channel> = {}): Channel {
  return {
    configPreview: {},
    createdAt: "2026-08-19T10:00:00.000Z",
    enabled: true,
    id,
    lastDeliveryStatus: null,
    name: id,
    type: "EMAIL",
    verifiedAt: null,
    ...overrides,
  };
}

describe("browser test form", () => {
  it("mirrors the API validation limits", () => {
    expect(testFormSchema.safeParse(valid).success).toBe(true);
    expect(testFormSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(testFormSchema.safeParse({ ...valid, name: "x".repeat(121) }).success).toBe(false);
    expect(testFormSchema.safeParse({ ...valid, instructions: "   " }).success).toBe(false);
    expect(testFormSchema.safeParse({ ...valid, startUrl: "ftp://example.com" }).success).toBe(false);
    expect(testFormSchema.safeParse({ ...valid, startUrl: "not a url" }).success).toBe(false);
    expect(testFormSchema.safeParse({ ...valid, intervalHours: 25 }).success).toBe(false);
    expect(testFormSchema.safeParse({ ...valid, maxRetries: 4 }).success).toBe(false);
    expect(
      testFormSchema.safeParse({ ...valid, allowedDomains: ["https://example.com"] }).success,
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
    expect(intervalOptionLabel(1)).toBe("Every 1 hour");
    expect(intervalOptionLabel(6)).toBe("Every 6 hours");
    expect(retryOptions).toEqual([0, 1, 2, 3]);
    expect(retryOptionLabel(0)).toBe("0 retries — no retries");
    expect(retryOptionLabel(1)).toBe("1 retry — immediately");
    expect(retryOptionLabel(3)).toBe("3 retries — immediately, after 1 min, after 2 min");
  });

  it("keeps the required safety and timeout copy verbatim", () => {
    expect(stagingCredentialsCopy).toBe(
      "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.",
    );
    expect(timeoutHelpCopy).toContain("Each attempt can run for up to 5 minutes.");
    expect(tokenNoteCopy).toContain("nominal maximum of 200,000 tokens");
  });

  it("maps API validation details onto form fields only", () => {
    expect(isTestFormField("startUrl")).toBe(true);
    expect(isTestFormField("tests.0.startUrl")).toBe(false);
    expect(isTestFormField("toString")).toBe(false);
    expect(testFormDefaults.intervalHours).toBe(24);
    expect(testFormDefaults.maxRetries).toBe(1);
  });

  it("preselects enabled default channels for a new test", () => {
    expect(
      defaultChannelIds([
        channel("a", { isDefault: true }),
        channel("b", { enabled: false, isDefault: true }),
        channel("c"),
      ]),
    ).toEqual(["a"]);
  });

  it("loads an existing test into the form values", () => {
    const test: BrowserTest = {
      channelIds: ["a"],
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: null,
      device: "MOBILE",
      id: "test_1",
      instructions: "Check the page",
      intervalHours: 6,
      lastRun: null,
      maxRetries: 2,
      name: "Checkout",
      nextRunAt: "2026-08-19T16:00:00.000Z",
      notifyOnRecovery: false,
      openIncidentId: null,
      startUrl: "https://example.com",
      updatedAt: "2026-08-19T10:00:00.000Z",
    };
    expect(testFormValues(test)).toEqual({
      allowedDomains: [],
      writableDomains: [],
      testDataAttested: false,
      irreversibleActionScopesJson: "[]",
      channelIds: ["a"],
      device: "MOBILE",
      instructions: "Check the page",
      intervalHours: 6,
      maxRetries: 2,
      name: "Checkout",
      notifyOnRecovery: false,
      startUrl: "https://example.com",
    });
    expect(testFormSchema.safeParse(testFormValues(test)).success).toBe(true);
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
});
