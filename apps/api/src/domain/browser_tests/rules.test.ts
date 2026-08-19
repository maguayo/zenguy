import { RUNNER_VERSION } from "../../shared/constants";
import {
  browserTestConfigSchema,
  buildSnapshot,
  computeNextRunAt,
} from "./rules";

const VALID = {
  name: "Checkout",
  startUrl: "https://shop.example.com/checkout",
  instructions: "Complete the checkout flow",
  device: "DESKTOP",
  intervalHours: 6,
  maxRetries: 2,
  notifyOnRecovery: true,
  channelIds: ["ch_email", "ch_sms"],
} as const;

describe("browserTestConfigSchema", () => {
  it("parses the complete config and trims its name", () => {
    expect(browserTestConfigSchema.parse({ ...VALID, name: " Checkout " })).toEqual(
      VALID,
    );
  });

  it.each([
    [{ ...VALID, name: "" }, "name"],
    [{ ...VALID, name: "x".repeat(121) }, "name"],
    [{ ...VALID, startUrl: "http://127.0.0.1/admin" }, "startUrl"],
    [{ ...VALID, startUrl: "ftp://example.com/file" }, "startUrl"],
    [{ ...VALID, instructions: "" }, "instructions"],
    [{ ...VALID, instructions: "x".repeat(10_001) }, "instructions"],
    [{ ...VALID, device: "TABLET" }, "device"],
    [{ ...VALID, intervalHours: 0 }, "intervalHours"],
    [{ ...VALID, intervalHours: 25 }, "intervalHours"],
    [{ ...VALID, maxRetries: -1 }, "maxRetries"],
    [{ ...VALID, maxRetries: 4 }, "maxRetries"],
    [{ ...VALID, channelIds: Array.from({ length: 11 }, (_, i) => `ch_${i}`) }, "channelIds"],
  ])("rejects an invalid %s config", (input, field) => {
    const result = browserTestConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toContain(field);
  });
});

describe("browser test scheduling rules", () => {
  it("builds an immutable execution snapshot with the device viewport", () => {
    const config = browserTestConfigSchema.parse(VALID);

    expect(buildSnapshot(config, "gpt-5-mini")).toEqual({
      ...VALID,
      channelIds: ["ch_email", "ch_sms"],
      viewport: { width: 1440, height: 900 },
      modelName: "gpt-5-mini",
      runnerVersion: RUNNER_VERSION,
    });
    expect(
      buildSnapshot({ ...config, device: "MOBILE" }, "gpt-5-mini").viewport,
    ).toEqual({ width: 390, height: 844 });
  });

  it("computes the next run in whole interval hours", () => {
    expect(computeNextRunAt(1_000, 6)).toBe(21_601_000);
  });
});
