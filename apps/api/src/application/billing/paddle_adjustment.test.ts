import { describe, expect, it } from "vitest";
import { toPaddleLedgerAdjustmentAmount } from "./paddle_adjustment";

describe("toPaddleLedgerAdjustmentAmount", () => {
  it.each(["credit", "refund", "chargeback", "chargeback_warning"])(
    "turns a %s total into a ledger debit independent of provider sign",
    (action) => {
      expect(toPaddleLedgerAdjustmentAmount(action, 400)).toBe(-400);
      expect(toPaddleLedgerAdjustmentAmount(action, -400)).toBe(-400);
    },
  );

  it.each([
    "credit_reverse",
    "chargeback_reverse",
    "chargeback_warning_reverse",
  ])("turns a %s total into a bounded ledger restoration", (action) => {
    expect(toPaddleLedgerAdjustmentAmount(action, -400)).toBe(400);
    expect(toPaddleLedgerAdjustmentAmount(action, 400)).toBe(400);
  });

  it("fails closed for unknown actions and invalid totals", () => {
    expect(() =>
      toPaddleLedgerAdjustmentAmount("future_action", 400),
    ).toThrow("unsupported");
    expect(() => toPaddleLedgerAdjustmentAmount("refund", 0)).toThrow(
      "invalid",
    );
    expect(() =>
      toPaddleLedgerAdjustmentAmount("refund", Number.MAX_SAFE_INTEGER + 1),
    ).toThrow("invalid");
  });
});
