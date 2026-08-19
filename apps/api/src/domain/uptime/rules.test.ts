import { UPTIME_FREQUENCIES_SECONDS } from "../../shared/constants";
import { monitorConfigSchema } from "./rules";

const VALID = {
  name: "API health",
  url: "https://api.example.com/health",
  method: "POST",
  headers: [{ key: "Authorization", value: "Bearer {{API_TOKEN}}" }],
  body: JSON.stringify({ probe: true }),
  expectedStatus: 200,
  bodyCondition: "JSON_PATH_EQUALS",
  bodyExpectedValue: "ok",
  bodyConditionPath: "$.status",
  frequencySeconds: 300,
  timeoutSeconds: 10,
  maxRetries: 2,
  notifyOnRecovery: true,
  channelIds: ["ch_ops"],
} as const;

describe("monitorConfigSchema", () => {
  it("accepts the complete config and applies documented defaults", () => {
    expect(monitorConfigSchema.parse({
      ...VALID,
      name: " API health ",
      expectedStatus: undefined,
      timeoutSeconds: undefined,
      notifyOnRecovery: undefined,
    })).toMatchObject({
      ...VALID,
      name: "API health",
      expectedStatus: 200,
      timeoutSeconds: 10,
      notifyOnRecovery: true,
    });
    expect(UPTIME_FREQUENCIES_SECONDS[0]).toBe(300);
  });

  it.each([
    [{ ...VALID, name: "" }, "name"],
    [{ ...VALID, name: "x".repeat(121) }, "name"],
    [{ ...VALID, url: "http://169.254.169.254/latest" }, "url"],
    [{ ...VALID, method: "OPTIONS" }, "method"],
    [{ ...VALID, headers: [{ key: "Bad header", value: "x" }] }, "headers"],
    [
      {
        ...VALID,
        headers: Array.from({ length: 21 }, (_, index) => ({
          key: `X-Test-${index}`,
          value: "x",
        })),
      },
      "headers",
    ],
    [{ ...VALID, headers: [{ key: "X-Test", value: "x".repeat(2_049) }] }, "headers"],
    [{ ...VALID, body: "x".repeat(16_385) }, "body"],
    [{ ...VALID, expectedStatus: 99 }, "expectedStatus"],
    [{ ...VALID, expectedStatus: 600 }, "expectedStatus"],
    [{ ...VALID, frequencySeconds: 60 }, "frequencySeconds"],
    [{ ...VALID, timeoutSeconds: 0 }, "timeoutSeconds"],
    [{ ...VALID, timeoutSeconds: 31 }, "timeoutSeconds"],
    [{ ...VALID, maxRetries: -1 }, "maxRetries"],
    [{ ...VALID, maxRetries: 4 }, "maxRetries"],
    [
      {
        ...VALID,
        channelIds: Array.from({ length: 11 }, (_, index) => `ch_${index}`),
      },
      "channelIds",
    ],
  ])("rejects an invalid config at %s", (input, field) => {
    const result = monitorConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toContain(field);
  });

  it("enforces method/body and conditional expectation fields", () => {
    for (const method of ["GET", "HEAD"] as const) {
      const result = monitorConfigSchema.safeParse({ ...VALID, method });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: ["body"] })]),
        );
      }
    }
    for (const input of [
      { ...VALID, bodyExpectedValue: undefined },
      {
        ...VALID,
        bodyCondition: undefined,
        bodyExpectedValue: "orphan",
        bodyConditionPath: undefined,
      },
      { ...VALID, bodyConditionPath: undefined },
      {
        ...VALID,
        bodyCondition: "CONTAINS",
        bodyConditionPath: "$.status",
      },
      { ...VALID, bodyConditionPath: "$.invalid-key!" },
    ]) {
      expect(monitorConfigSchema.safeParse(input).success).toBe(false);
    }
    expect(
      monitorConfigSchema.safeParse({
        ...VALID,
        bodyCondition: null,
        bodyExpectedValue: null,
        bodyConditionPath: null,
      }).success,
    ).toBe(true);
  });
});
