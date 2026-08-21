import {
  GSM7_SINGLE_SEGMENT,
  SMS_OPT_OUT_SUFFIX,
  UCS2_SINGLE_SEGMENT,
  isGsm7,
  smsBody,
  smsEncodedLength,
  smsSegments,
} from "./sms";

describe("smsSegments", () => {
  it("classifies GSM-7 and UCS-2 text", () => {
    expect(isGsm7("Zenguy: FAILED Checkout (browser test).")).toBe(true);
    expect(isGsm7("Señor año ñ ü è")).toBe(true);
    expect(isGsm7("Más")).toBe(false);
    expect(isGsm7("emoji 🚨")).toBe(false);
    expect(smsEncodedLength("a€b")).toBe(4);
  });

  it("counts segments per encoding", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(306))).toBe(2);
    expect(smsSegments("a".repeat(307))).toBe(3);
    expect(smsSegments("á".repeat(70))).toBe(1);
    expect(smsSegments("á".repeat(71))).toBe(2);
  });
});

describe("smsBody", () => {
  it("strips links, appends the opt-out suffix, and keeps short alerts intact", () => {
    expect(
      smsBody(
        "Zenguy: FAILED Checkout (browser test). https://app.zenguy.com/w/ws_1/incidents/inc_1",
      ),
    ).toBe(`Zenguy: FAILED Checkout (browser test).${SMS_OPT_OUT_SUFFIX}`);
  });

  it("trims long alerts to exactly one GSM-7 segment", () => {
    const body = smsBody(
      `Zenguy: DOWN ${"Very long monitor name ".repeat(12)} (uptime monitor). https://app.zenguy.com/x`,
    );
    expect(smsSegments(body)).toBe(1);
    expect(smsEncodedLength(body)).toBeLessThanOrEqual(GSM7_SINGLE_SEGMENT);
    expect(body.endsWith(`...${SMS_OPT_OUT_SUFFIX}`)).toBe(true);
  });

  it("trims long alerts to exactly one UCS-2 segment", () => {
    const body = smsBody(`Zenguy: DOWN ${"Árbol ".repeat(30)} (uptime monitor).`);
    expect(isGsm7(body)).toBe(false);
    expect(smsSegments(body)).toBe(1);
    expect(body.length).toBeLessThanOrEqual(UCS2_SINGLE_SEGMENT);
    expect(body.endsWith(`...${SMS_OPT_OUT_SUFFIX}`)).toBe(true);
  });
});
