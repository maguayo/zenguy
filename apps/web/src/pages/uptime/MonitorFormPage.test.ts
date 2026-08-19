import { describe, expect, it } from "vitest";

import {
  frequencyOptions,
  monitorFormSchema,
  monitorRetryOptionLabel,
  testRequestNote,
  toMonitorInput,
  uptimeCostNote,
  type MonitorFormValues,
} from "./MonitorFormPage";

const valid: MonitorFormValues = {
  body: "",
  bodyCondition: null,
  bodyConditionPath: "",
  bodyExpectedValue: "",
  channelIds: [],
  expectedStatus: 200,
  frequencySeconds: 300,
  headers: [{ key: "Authorization", value: "Bearer {{API_TOKEN}}" }],
  maxRetries: 1,
  method: "GET",
  name: "Health endpoint",
  notifyOnRecovery: true,
  timeoutSeconds: 10,
  url: "https://api.example.com/health",
};

describe("uptime monitor form", () => {
  it("mirrors the API limits and exact frequency set", () => {
    expect(monitorFormSchema.safeParse(valid).success).toBe(true);
    expect(monitorFormSchema.safeParse({ ...valid, expectedStatus: 99 }).success).toBe(false);
    expect(monitorFormSchema.safeParse({ ...valid, frequencySeconds: 60 }).success).toBe(false);
    expect(monitorFormSchema.safeParse({ ...valid, timeoutSeconds: 31 }).success).toBe(false);
    expect(monitorFormSchema.safeParse({ ...valid, maxRetries: 4 }).success).toBe(false);
    expect(frequencyOptions.map(({ value }) => value)).toEqual([
      300, 600, 900, 1_800, 3_600, 10_800, 21_600, 43_200, 86_400,
    ]);
  });

  it("forbids GET and HEAD bodies", () => {
    expect(monitorFormSchema.safeParse({ ...valid, body: "payload" }).success).toBe(false);
    expect(
      monitorFormSchema.safeParse({ ...valid, body: "payload", method: "HEAD" }).success,
    ).toBe(false);
    expect(
      monitorFormSchema.safeParse({ ...valid, body: "payload", method: "POST" }).success,
    ).toBe(true);
  });

  it("requires a value for conditions and a path for JSON path equals", () => {
    expect(
      monitorFormSchema.safeParse({ ...valid, bodyCondition: "CONTAINS" }).success,
    ).toBe(false);
    expect(
      monitorFormSchema.safeParse({
        ...valid,
        bodyCondition: "JSON_PATH_EQUALS",
        bodyExpectedValue: "true",
      }).success,
    ).toBe(false);
    expect(
      monitorFormSchema.safeParse({
        ...valid,
        bodyCondition: "JSON_PATH_EQUALS",
        bodyConditionPath: "$.status.healthy",
        bodyExpectedValue: "true",
      }).success,
    ).toBe(true);
  });

  it("normalizes hidden fields for the API without leaking a stale body", () => {
    expect(toMonitorInput({ ...valid, body: "stale" })).not.toHaveProperty("body");
    expect(
      toMonitorInput({
        ...valid,
        body: "{}",
        bodyCondition: "EQUALS",
        bodyExpectedValue: "{}",
        method: "POST",
      }),
    ).toMatchObject({
      body: "{}",
      bodyCondition: "EQUALS",
      bodyConditionPath: null,
      bodyExpectedValue: "{}",
    });
  });

  it("keeps retry descriptions and billing copy explicit", () => {
    expect(monitorRetryOptionLabel(3)).toBe(
      "3 retries — immediately, after 1 min, after 2 min",
    );
    expect(testRequestNote).toBe(
      "Runs the request once from Zenguy. Nothing is saved and no runs are consumed.",
    );
    expect(uptimeCostNote).toBe(
      "Uptime checks and retries never consume browser test runs.",
    );
  });
});
