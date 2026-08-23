const DEBIT_ACTIONS = new Set([
  "credit",
  "refund",
  "chargeback",
  "chargeback_warning",
]);
const REVERSAL_ACTIONS = new Set([
  "credit_reverse",
  "chargeback_reverse",
  "chargeback_warning_reverse",
]);

/**
 * Converts a Paddle adjustment to the signed alert-credit ledger amount.
 * Direction comes from Paddle's action contract, not from the representation
 * of `totals.total`: the public API example uses a negative credit-reversal
 * total, while reversal actions themselves unambiguously restore funds. The
 * ledger separately limits every restoration to prior debits for the same
 * provider transaction, so a signed webhook cannot create unbacked credit.
 */
export function toPaddleLedgerAdjustmentAmount(
  action: string,
  providerTotalCents: number,
): number {
  if (!Number.isSafeInteger(providerTotalCents) || providerTotalCents === 0) {
    throw new Error("Paddle adjustment total is invalid");
  }
  const magnitudeCents = Math.abs(providerTotalCents);
  if (DEBIT_ACTIONS.has(action)) {
    return -magnitudeCents;
  }
  if (REVERSAL_ACTIONS.has(action)) {
    return magnitudeCents;
  }
  throw new Error("Paddle adjustment action is unsupported");
}
