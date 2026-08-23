import { RUNNER_VERSION } from "../../shared/constants";
import {
  browserTestConfigSchema,
  buildSnapshot,
  computeNextRunAt,
} from "./rules";

const VALID = {
  name: "Checkout",
  allowedDomains: [] as string[],
  writableDomains: [] as string[],
  testDataAttested: false,
  irreversibleActionScopes: [],
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
    [{ ...VALID, allowedDomains: ["https://example.com"] }, "allowedDomains"],
    [{ ...VALID, allowedDomains: ["EXAMPLE.com"] }, "allowedDomains"],
    [{ ...VALID, writableDomains: ["*.example.com"] }, "writableDomains"],
    [{ ...VALID, writableDomains: ["other.example.com"] }, "writableDomains"],
    [
      {
        ...VALID,
        allowedDomains: ["*.oauth.example.com"],
        writableDomains: ["oauth.example.com"],
      },
      "writableDomains",
    ],
    [
      {
        ...VALID,
        allowedDomains: Array.from({ length: 21 }, (_, i) => `host${i}.example.com`),
      },
      "allowedDomains",
    ],
    [{ ...VALID, channelIds: Array.from({ length: 11 }, (_, i) => `ch_${i}`) }, "channelIds"],
  ])("rejects an invalid %s config", (input, field) => {
    const result = browserTestConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toContain(field);
  });

  it("requires staging attestation and canonical HTTPS origins for action scopes", () => {
    const scope = {
      kind: "HTTP" as const,
      method: "POST" as const,
      origin: "https://shop.example.com",
      path: "/orders",
      maxUses: 1,
    };
    expect(
      browserTestConfigSchema.safeParse({
        ...VALID,
        testDataAttested: true,
        irreversibleActionScopes: [scope],
      }).success,
    ).toBe(true);
    expect(
      browserTestConfigSchema.safeParse({
        ...VALID,
        irreversibleActionScopes: [scope],
      }).success,
    ).toBe(false);
    for (const origin of [
      "http://shop.example.com",
      "https://shop.example.com/",
      "https://SHOP.example.com",
    ]) {
      expect(
        browserTestConfigSchema.safeParse({
          ...VALID,
          testDataAttested: true,
          irreversibleActionScopes: [{ ...scope, origin }],
        }).success,
      ).toBe(false);
    }
  });

  it("requires a DOM locator to be unique and bound to its exact form POST", () => {
    const httpScope = {
      kind: "HTTP" as const,
      method: "POST" as const,
      origin: "https://shop.example.com",
      path: "/orders",
      maxUses: 1,
    };
    const domScope = {
      kind: "DOM" as const,
      action: "CLICK" as const,
      origin: "https://shop.example.com",
      path: "/checkout",
      target: {
        attribute: "data-testid" as const,
        value: "place-order",
        tag: "BUTTON" as const,
        type: "submit" as const,
        form: {
          method: "POST" as const,
          origin: httpScope.origin,
          path: httpScope.path,
        },
      },
      maxUses: 1,
    };
    const config = {
      ...VALID,
      writableDomains: ["shop.example.com"],
      testDataAttested: true,
    };

    expect(
      browserTestConfigSchema.safeParse({
        ...config,
        irreversibleActionScopes: [domScope, httpScope],
      }).success,
    ).toBe(true);
    expect(
      browserTestConfigSchema.safeParse({
        ...config,
        irreversibleActionScopes: [domScope],
      }).success,
    ).toBe(false);
    expect(
      browserTestConfigSchema.safeParse({
        ...config,
        irreversibleActionScopes: [
          domScope,
          { ...domScope, target: { ...domScope.target, tag: "INPUT" as const } },
          { ...httpScope, maxUses: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      browserTestConfigSchema.safeParse({
        ...config,
        irreversibleActionScopes: [
          {
            ...domScope,
            target: {
              attribute: domScope.target.attribute,
              value: domScope.target.value,
            },
          },
          httpScope,
        ],
      }).success,
    ).toBe(false);
  });
});

describe("browser test scheduling rules", () => {
  it("builds an immutable execution snapshot with the device viewport", () => {
    const config = browserTestConfigSchema.parse(VALID);
    const {
      testDataAttested: _testDataAttested,
      irreversibleActionScopes: _irreversibleActionScopes,
      ...snapshotConfig
    } = VALID;

    expect(buildSnapshot(config, "gpt-5-mini")).toEqual({
      ...snapshotConfig,
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
