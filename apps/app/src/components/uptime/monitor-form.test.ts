import { describe, expect, it } from "@jest/globals";

import type { Channel, Monitor } from "@/api/types";

import {
  bodyConditionOptions,
  defaultChannelIds,
  frequencyOptions,
  headersMaskedNote,
  isMonitorFormField,
  monitorFormDefaults,
  monitorFormSchema,
  monitorRetryOptionLabel,
  monitorToFormValues,
  parseNumberInput,
  retryOptions,
  supportsBody,
  testRequestNote,
  toMonitorInput,
  uptimeCostNote,
  type MonitorFormValues,
} from "./monitor-form";

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

const monitor: Monitor = {
  body: null,
  bodyCondition: "JSON_PATH_EQUALS",
  bodyConditionPath: "$.status.healthy",
  bodyExpectedValue: "true",
  channelIds: ["channel_1"],
  checking: false,
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: null,
  expectedStatus: 204,
  frequencySeconds: 900,
  headers: null,
  headersMasked: true,
  id: "monitor_1",
  lastCheckAt: null,
  lastResponseTimeMs: null,
  maxRetries: 2,
  method: "HEAD",
  name: "Storefront home",
  nextCheckAt: "2026-08-19T10:05:00.000Z",
  notifyOnRecovery: false,
  openIncidentId: null,
  status: "UNKNOWN",
  timeoutSeconds: 5,
  updatedAt: "2026-08-19T10:00:00.000Z",
  url: "https://shop.example.com/health",
};

function channel(overrides: Partial<Channel>): Channel {
  return {
    configPreview: {},
    createdAt: "2026-08-19T10:00:00.000Z",
    enabled: true,
    id: "channel_1",
    lastDeliveryStatus: null,
    name: "Ops email",
    type: "EMAIL",
    verifiedAt: null,
    ...overrides,
  };
}

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

  it("validates names, URLs and header names with the web messages", () => {
    const blankName = monitorFormSchema.safeParse({ ...valid, name: "  " });
    expect(blankName.success).toBe(false);
    expect(blankName.error?.issues[0]?.message).toBe("Name is required.");

    const ftp = monitorFormSchema.safeParse({ ...valid, url: "ftp://example.com/file" });
    expect(ftp.success).toBe(false);
    expect(ftp.error?.issues[0]?.message).toBe("URL must start with http:// or https://.");

    const badHeader = monitorFormSchema.safeParse({
      ...valid,
      headers: [{ key: "X Token", value: "1" }],
    });
    expect(badHeader.success).toBe(false);
    expect(badHeader.error?.issues[0]?.path).toEqual(["headers", 0, "key"]);
    expect(badHeader.error?.issues[0]?.message).toBe("Use letters, numbers, and hyphens only.");
  });

  it("forbids GET and HEAD bodies", () => {
    expect(monitorFormSchema.safeParse({ ...valid, body: "payload" }).success).toBe(false);
    expect(
      monitorFormSchema.safeParse({ ...valid, body: "payload", method: "HEAD" }).success,
    ).toBe(false);
    expect(
      monitorFormSchema.safeParse({ ...valid, body: "payload", method: "POST" }).success,
    ).toBe(true);
    expect(supportsBody("GET")).toBe(false);
    expect(supportsBody("HEAD")).toBe(false);
    expect(supportsBody("PATCH")).toBe(true);
  });

  it("requires a value for conditions and a path for JSON path equals", () => {
    expect(
      monitorFormSchema.safeParse({ ...valid, bodyCondition: "CONTAINS" }).success,
    ).toBe(false);
    expect(
      monitorFormSchema.safeParse({ ...valid, bodyExpectedValue: "orphan" }).success,
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
        bodyCondition: "CONTAINS",
        bodyConditionPath: "$.x",
        bodyExpectedValue: "ok",
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
    expect(toMonitorInput({ ...valid, name: "  Padded  " })).toMatchObject({
      headers: valid.headers,
      name: "Padded",
    });
  });

  it("leaves masked headers untouched when saving", () => {
    const input = toMonitorInput(valid, { headersMasked: true });
    expect(input).not.toHaveProperty("headers");
    expect(toMonitorInput(valid, { headersMasked: false }).headers).toEqual(valid.headers);
    expect(headersMaskedNote).toBe("Masked for your role");
  });

  it("maps a monitor into editable values and back", () => {
    const values = monitorToFormValues(monitor);
    expect(values).toEqual({
      body: "",
      bodyCondition: "JSON_PATH_EQUALS",
      bodyConditionPath: "$.status.healthy",
      bodyExpectedValue: "true",
      channelIds: ["channel_1"],
      expectedStatus: 204,
      frequencySeconds: 900,
      headers: [],
      maxRetries: 2,
      method: "HEAD",
      name: "Storefront home",
      notifyOnRecovery: false,
      timeoutSeconds: 5,
      url: "https://shop.example.com/health",
    });
    expect(monitorFormSchema.safeParse(values).success).toBe(true);
    expect(toMonitorInput(values, { headersMasked: monitor.headersMasked })).toEqual({
      bodyCondition: "JSON_PATH_EQUALS",
      bodyConditionPath: "$.status.healthy",
      bodyExpectedValue: "true",
      channelIds: ["channel_1"],
      expectedStatus: 204,
      frequencySeconds: 900,
      maxRetries: 2,
      method: "HEAD",
      name: "Storefront home",
      notifyOnRecovery: false,
      timeoutSeconds: 5,
      url: "https://shop.example.com/health",
    });
  });

  it("keeps retry descriptions and billing copy explicit", () => {
    expect(monitorRetryOptionLabel(0)).toBe("0 retries — no retries");
    expect(monitorRetryOptionLabel(1)).toBe("1 retry — immediately");
    expect(monitorRetryOptionLabel(3)).toBe(
      "3 retries — immediately, after 1 min, after 2 min",
    );
    expect(retryOptions.map(({ value }) => value)).toEqual([0, 1, 2, 3]);
    expect(bodyConditionOptions.map(({ label }) => label)).toEqual([
      "None",
      "Body contains",
      "Body does not contain",
      "Body equals",
      "JSON path equals",
    ]);
    expect(testRequestNote).toBe(
      "Runs the request once from Zenguy. Nothing is saved and no runs are consumed.",
    );
    expect(uptimeCostNote).toBe(
      "Uptime checks and retries never consume browser test runs.",
    );
  });

  it("only maps API details onto real form fields", () => {
    expect(isMonitorFormField("url")).toBe(true);
    expect(isMonitorFormField("channelIds")).toBe(true);
    expect(isMonitorFormField("toString")).toBe(false);
    expect(isMonitorFormField("workspaceId")).toBe(false);
    expect(monitorFormSchema.safeParse(monitorFormDefaults).success).toBe(false);
  });

  it("preselects enabled default channels for a new monitor", () => {
    expect(
      defaultChannelIds([
        channel({ id: "a", isDefault: true }),
        channel({ enabled: false, id: "b", isDefault: true }),
        channel({ id: "c" }),
      ]),
    ).toEqual(["a"]);
  });

  it("parses numeric entry like valueAsNumber", () => {
    expect(parseNumberInput("200")).toBe(200);
    expect(parseNumberInput(" 30 ")).toBe(30);
    expect(Number.isNaN(parseNumberInput(""))).toBe(true);
    expect(Number.isNaN(parseNumberInput("2a"))).toBe(true);
  });
});
