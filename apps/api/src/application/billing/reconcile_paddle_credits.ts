import type { AlertRepo } from "../../domain/alerts/repo";
import type { PaddleTopupForReconciliation } from "../../domain/alerts/repo";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { PaddleClient } from "../../infrastructure/paddle/client";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import type { WriteAudit } from "../audit/write_audit";
import { toPaddleLedgerAdjustmentAmount } from "./paddle_adjustment";

const RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const RECONCILIATION_BATCH = 50;
/** Repairs missed/delayed provider adjustments without racing webhooks. */
export class ReconcilePaddleCredits {
  constructor(
    private readonly alerts: Pick<
      AlertRepo,
      | "listTopupsNeedingReconciliation"
      | "markTopupReconciled"
      | "adjust"
    >,
    private readonly paddle: Pick<PaddleClient, "listApprovedAdjustments">,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly provider: "paddle" | "stripe" = "paddle",
  ) {}

  private async reconcileTopup(
    topup: PaddleTopupForReconciliation,
    now: number,
  ): Promise<number> {
    if (topup.providerCustomerId === null) {
      throw new Error("Billing reconciliation customer identity missing");
    }
    // Provider IDs are immutable; shared ledger keys make webhook and poller
    // delivery safe to race.
    const adjustments = await this.paddle.listApprovedAdjustments(
      topup.providerTransactionId,
    );
    let adjustmentsWritten = 0;
    for (const adjustment of adjustments) {
      const amountCents = toPaddleLedgerAdjustmentAmount(
        adjustment.action,
        adjustment.amountCents,
      );
      if (
        adjustment.transactionId !== topup.providerTransactionId ||
        adjustment.currency !== "EUR" ||
        !Number.isSafeInteger(adjustment.amountCents)
      ) {
        throw new Error("Billing reconciliation amount or currency mismatch");
      }
      if (adjustment.customerId !== topup.providerCustomerId) {
        throw new Error("Billing reconciliation customer mismatch");
      }
      const idempotencyKey =
        this.provider === "stripe"
          ? `stripe_refund:${adjustment.id}:succeeded`
          : `paddle_adjustment:${adjustment.id}:approved`;
      const written = await this.alerts.adjust({
        id: this.ids.newId("ace"),
        workspaceId: topup.workspaceId,
        amountCents,
        idempotencyKey,
        description: `${this.provider === "stripe" ? "Stripe" : "Paddle"} ${adjustment.action} (${adjustment.id})`,
        providerTransactionId: topup.providerTransactionId,
        at: now,
      });
      if (written === null) {
        throw new Error("Billing adjustment exceeds credited transaction");
      }
      if (written.created) {
        adjustmentsWritten += 1;
        await this.audit.execute({
          workspaceId: topup.workspaceId,
          actorUserId: null,
          action: AUDIT_ACTIONS.alertsCreditAdjusted,
          resourceType: "alert_credit",
          resourceId: adjustment.id,
          metadata: {
            action: adjustment.action,
            amountCents,
            transactionId: topup.providerTransactionId,
            source: "reconciliation",
          },
        });
      }
    }
    await this.alerts.markTopupReconciled(topup.providerTransactionId, now);
    return adjustmentsWritten;
  }

  async execute(): Promise<{ checked: number; adjustments: number }> {
    const now = this.clock.now();
    const topups = await this.alerts.listTopupsNeedingReconciliation(
      now - RECONCILIATION_INTERVAL_MS,
      RECONCILIATION_BATCH,
    );
    let adjustmentsWritten = 0;
    let checked = 0;
    const failures: unknown[] = [];
    for (const topup of topups) {
      try {
        adjustmentsWritten += await this.reconcileTopup(topup, now);
        checked += 1;
      } catch (error) {
        // One permanently malformed provider record must not starve every
        // later refund in the oldest-first batch. Leave this top-up pending,
        // continue the batch, and fail once at the end so operations alert.
        failures.push(error);
      }
    }
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        `Billing credit reconciliation failed for ${failures.length} top-up(s)`,
      );
    }
    return { checked, adjustments: adjustmentsWritten };
  }
}
