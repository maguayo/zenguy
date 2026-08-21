import { describe, expect, it } from "@jest/globals";

import type { Check } from "@/api/types";

import {
  checkSummary,
  expectationSummary,
  formatResponseTime,
  monitorHeaderLines,
  monitorHost,
  retriesLabel,
  uptimeTone,
} from "./monitor-display";

const check: Check = {
  attemptIndex: 0,
  checkedAt: "2026-08-19T10:00:00.000Z",
  cycleId: "cycle_1",
  failureReason: "Expected 200, got 503",
  httpStatus: 503,
  id: "check_1",
  responseTimeMs: 184,
  status: "FAILED",
};

describe("monitor host", () => {
  it("shows the host but never the path or query string", () => {
    expect(monitorHost("https://shop.example.com/health?private=value")).toBe("shop.example.com");
    expect(monitorHost("http://localhost:8787/api/health#frag")).toBe("localhost:8787");
    expect(monitorHost("https://user:secret@api.example.com/x")).toBe("api.example.com");
    expect(monitorHost("HTTPS://API.Example.com:443/")).toBe("api.example.com");
  });

  it("falls back safely when a host cannot be parsed", () => {
    expect(monitorHost("not a url")).toBe("not a url");
  });
});

describe("uptime monitor detail", () => {
  it("applies the uptime thresholds exactly", () => {
    expect(uptimeTone(null)).toBe("neutral");
    expect(uptimeTone(100)).toBe("ok");
    expect(uptimeTone(99.9)).toBe("ok");
    expect(uptimeTone(99)).toBe("warn");
    expect(uptimeTone(98.99)).toBe("danger");
  });

  it("summarizes status and conditional body expectations", () => {
    expect(
      expectationSummary({
        bodyCondition: null,
        bodyConditionPath: null,
        bodyExpectedValue: null,
        expectedStatus: 204,
      }),
    ).toBe("Status 204");
    expect(
      expectationSummary({
        bodyCondition: "CONTAINS",
        bodyConditionPath: null,
        bodyExpectedValue: "healthy",
        expectedStatus: 200,
      }),
    ).toBe('Status 200 · Body contains "healthy"');
    expect(
      expectationSummary({
        bodyCondition: "NOT_CONTAINS",
        bodyConditionPath: null,
        bodyExpectedValue: "error",
        expectedStatus: 200,
      }),
    ).toBe('Status 200 · Body does not contain "error"');
    expect(
      expectationSummary({
        bodyCondition: "EQUALS",
        bodyConditionPath: null,
        bodyExpectedValue: "OK",
        expectedStatus: 200,
      }),
    ).toBe('Status 200 · Body equals "OK"');
    expect(
      expectationSummary({
        bodyCondition: "JSON_PATH_EQUALS",
        bodyConditionPath: "$.status.healthy",
        bodyExpectedValue: "true",
        expectedStatus: 200,
      }),
    ).toContain('JSON path $.status.healthy equals "true"');
  });

  it("keeps recent-check evidence formatting", () => {
    expect(checkSummary(check)).toEqual({
      httpStatus: "503",
      reason: "Expected 200, got 503",
      responseTime: "184 ms",
      result: "Failed",
      tone: "danger",
    });
    expect(
      checkSummary({ ...check, failureReason: null, httpStatus: null, responseTimeMs: null, status: "PASSED" }),
    ).toEqual({ httpStatus: "—", reason: "—", responseTime: "—", result: "Passed", tone: "ok" });
  });

  it("never leaks monitor headers to a member", () => {
    expect(monitorHeaderLines({ headers: null, headersMasked: true })).toEqual([
      "Masked for your role",
    ]);
    expect(
      monitorHeaderLines({
        headers: [{ key: "Authorization", value: "Bearer {{API_TOKEN}}" }],
        headersMasked: false,
      }),
    ).toEqual(["Authorization: Bearer {{API_TOKEN}}"]);
    expect(monitorHeaderLines({ headers: [], headersMasked: false })).toEqual(["None"]);
  });

  it("formats response times and retry counts", () => {
    expect(formatResponseTime(null)).toBe("—");
    expect(formatResponseTime(184)).toBe("184 ms");
    expect(retriesLabel(1)).toBe("1 retry");
    expect(retriesLabel(0)).toBe("0 retries");
  });
});
