import type {
  AlertRepo,
  AlertSettingsUpdate,
  CreditCreditInput,
  CreditAdjustmentInput,
  CreditDebitInput,
  LedgerWrite,
  LimitedDebitResult,
  PaddleTopupForReconciliation,
  WorkspaceNeedingDefaultChannel,
} from "../../domain/alerts/repo";
import type {
  AlertCreditEntry,
  AlertCreditEntryKind,
  AlertSettings,
} from "../../domain/alerts/types";
import type { Cursor } from "../../shared/pagination";
import { all, batch, isUniqueConstraintError, one, run } from "./d1";

interface SettingsRow {
  workspace_id: string;
  paid_channels_enabled: number;
  daily_paid_alert_limit: number;
  default_email_channel_created_at: number | null;
  default_push_channel_created_at: number | null;
  low_balance_notified_at: number | null;
  created_at: number;
  updated_at: number;
}

interface EntryRow {
  id: string;
  workspace_id: string;
  kind: AlertCreditEntryKind;
  amount_cents: number;
  balance_after_cents: number;
  delivery_id: string | null;
  provider_transaction_id: string | null;
  description: string;
  idempotency_key: string;
  created_at: number;
}

function toSettings(row: SettingsRow): AlertSettings {
  return {
    workspaceId: row.workspace_id,
    paidChannelsEnabled: row.paid_channels_enabled === 1,
    dailyPaidAlertLimit: row.daily_paid_alert_limit,
    defaultEmailChannelCreatedAt: row.default_email_channel_created_at,
    defaultPushChannelCreatedAt: row.default_push_channel_created_at ?? null,
    lowBalanceNotifiedAt: row.low_balance_notified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEntry(row: EntryRow): AlertCreditEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    amountCents: row.amount_cents,
    balanceAfterCents: row.balance_after_cents,
    deliveryId: row.delivery_id,
    providerTransactionId: row.provider_transaction_id,
    description: row.description,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

function entryToken(id: string, at: number): string {
  return `${id}:${at}`;
}

export class D1AlertRepo implements AlertRepo {
  constructor(private readonly database: D1Database) {}

  async findSettings(workspaceId: string): Promise<AlertSettings | null> {
    const row = await one<SettingsRow>(
      this.database
        .prepare("SELECT * FROM workspace_alert_settings WHERE workspace_id = ?")
        .bind(workspaceId),
    );
    return row === null ? null : toSettings(row);
  }

  async insertSettings(settings: AlertSettings): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO workspace_alert_settings
            (workspace_id, paid_channels_enabled, daily_paid_alert_limit,
             default_email_channel_created_at, default_push_channel_created_at,
             low_balance_notified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO NOTHING`,
        )
        .bind(
          settings.workspaceId,
          settings.paidChannelsEnabled ? 1 : 0,
          settings.dailyPaidAlertLimit,
          settings.defaultEmailChannelCreatedAt,
          settings.defaultPushChannelCreatedAt,
          settings.lowBalanceNotifiedAt,
          settings.createdAt,
          settings.updatedAt,
        ),
    );
  }

  async updateSettings(
    workspaceId: string,
    changes: AlertSettingsUpdate,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE workspace_alert_settings
           SET paid_channels_enabled = CASE WHEN ? = 1 THEN ? ELSE paid_channels_enabled END,
               daily_paid_alert_limit = CASE WHEN ? = 1 THEN ? ELSE daily_paid_alert_limit END,
               default_email_channel_created_at = CASE WHEN ? = 1 THEN ? ELSE default_email_channel_created_at END,
               default_push_channel_created_at = CASE WHEN ? = 1 THEN ? ELSE default_push_channel_created_at END,
               low_balance_notified_at = CASE WHEN ? = 1 THEN ? ELSE low_balance_notified_at END,
               updated_at = ?
           WHERE workspace_id = ?`,
        )
        .bind(
          changes.paidChannelsEnabled === undefined ? 0 : 1,
          changes.paidChannelsEnabled === true ? 1 : 0,
          changes.dailyPaidAlertLimit === undefined ? 0 : 1,
          changes.dailyPaidAlertLimit ?? 0,
          changes.defaultEmailChannelCreatedAt === undefined ? 0 : 1,
          changes.defaultEmailChannelCreatedAt ?? null,
          changes.defaultPushChannelCreatedAt === undefined ? 0 : 1,
          changes.defaultPushChannelCreatedAt ?? null,
          changes.lowBalanceNotifiedAt === undefined ? 0 : 1,
          changes.lowBalanceNotifiedAt ?? null,
          at,
          workspaceId,
        ),
    );
  }

  async getBalanceCents(workspaceId: string): Promise<number> {
    const row = await one<{ balance_cents: number }>(
      this.database
        .prepare(
          "SELECT balance_cents FROM alert_credit_balances WHERE workspace_id = ?",
        )
        .bind(workspaceId),
    );
    return row?.balance_cents ?? 0;
  }

  async findEntryByIdempotencyKey(
    key: string,
  ): Promise<AlertCreditEntry | null> {
    const row = await one<EntryRow>(
      this.database
        .prepare("SELECT * FROM alert_credit_entries WHERE idempotency_key = ?")
        .bind(key),
    );
    return row === null ? null : toEntry(row);
  }

  async findTopupByProviderTransactionId(
    id: string,
  ): Promise<PaddleTopupForReconciliation | null> {
    const row = await one<{
      workspace_id: string;
      provider_transaction_id: string;
      provider_customer_id: string | null;
      amount_cents: number;
    }>(
      this.database
        .prepare(
          `SELECT workspace_id, provider_transaction_id, provider_customer_id,
                  amount_cents
             FROM alert_credit_entries
           WHERE provider_transaction_id = ? AND kind = 'TOPUP'
           ORDER BY created_at ASC LIMIT 1`,
        )
        .bind(id),
    );
    return row === null
      ? null
      : {
          workspaceId: row.workspace_id,
          providerTransactionId: row.provider_transaction_id,
          providerCustomerId: row.provider_customer_id,
          amountCents: row.amount_cents,
        };
  }

  async listTopupsNeedingReconciliation(
    reconciledBefore: number,
    limit: number,
  ): Promise<PaddleTopupForReconciliation[]> {
    const rows = await all<{
      workspace_id: string;
      provider_transaction_id: string;
      provider_customer_id: string | null;
      amount_cents: number;
    }>(
      this.database
        .prepare(
          `SELECT workspace_id, provider_transaction_id, provider_customer_id,
                  amount_cents
             FROM alert_credit_entries
            WHERE kind = 'TOPUP'
              AND provider_transaction_id IS NOT NULL
              AND (provider_reconciled_at IS NULL OR provider_reconciled_at < ?)
            ORDER BY COALESCE(provider_reconciled_at, 0) ASC, created_at ASC
            LIMIT ?`,
        )
        .bind(reconciledBefore, limit),
    );
    return rows.map((row) => ({
      workspaceId: row.workspace_id,
      providerTransactionId: row.provider_transaction_id,
      providerCustomerId: row.provider_customer_id,
      amountCents: row.amount_cents,
    }));
  }

  async markTopupReconciled(
    providerTransactionId: string,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE alert_credit_entries
              SET provider_reconciled_at = ?
            WHERE kind = 'TOPUP' AND provider_transaction_id = ?`,
        )
        .bind(at, providerTransactionId),
    );
  }

  private insertEntryStatement(input: {
    id: string;
    workspaceId: string;
    kind: AlertCreditEntryKind;
    amountCents: number;
    deliveryId: string | null;
    providerTransactionId: string | null;
    providerCustomerId?: string | null;
    description: string;
    idempotencyKey: string;
    at: number;
    token: string;
  }): D1PreparedStatement {
    // Reads balance_after from the balance row and only inserts when that row
    // carries the token written by the preceding UPDATE in the same batch.
    return this.database
      .prepare(
        `INSERT INTO alert_credit_entries
          (id, workspace_id, kind, amount_cents, balance_after_cents,
           delivery_id, provider_transaction_id, provider_customer_id,
           description, idempotency_key, created_at)
         SELECT ?, ?, ?, ?, balance_cents, ?, ?, ?, ?, ?, ?
         FROM alert_credit_balances
         WHERE workspace_id = ? AND last_entry_token = ?`,
      )
      .bind(
        input.id,
        input.workspaceId,
        input.kind,
        input.amountCents,
        input.deliveryId,
        input.providerTransactionId,
        input.providerCustomerId ?? null,
        input.description,
        input.idempotencyKey,
        input.at,
        input.workspaceId,
        input.token,
      );
  }

  async debit(input: CreditDebitInput): Promise<LedgerWrite | null> {
    const existing = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) return { entry: existing, created: false };
    const token = entryToken(input.id, input.at);
    try {
      await batch(this.database, [
        this.database
          .prepare(
            `UPDATE alert_credit_balances
             SET balance_cents = balance_cents - ?,
                 last_entry_token = ?,
                 updated_at = ?
             WHERE workspace_id = ? AND balance_cents >= ?`,
          )
          .bind(
            input.amountCents,
            token,
            input.at,
            input.workspaceId,
            input.amountCents,
          ),
        this.insertEntryStatement({
          id: input.id,
          workspaceId: input.workspaceId,
          kind: "CHARGE",
          amountCents: -input.amountCents,
          deliveryId: input.deliveryId,
          providerTransactionId: null,
          description: input.description,
          idempotencyKey: input.idempotencyKey,
          at: input.at,
          token,
        }),
      ]);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replayed = await this.findEntryByIdempotencyKey(
        input.idempotencyKey,
      );
      if (replayed === null) throw error;
      return { entry: replayed, created: false };
    }
    const entry = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    return entry === null ? null : { entry, created: true };
  }

  async debitWithinDailyLimit(
    input: CreditDebitInput,
    dailyLimit: number,
    since: number,
  ): Promise<LimitedDebitResult> {
    const existing = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      return {
        status: "written",
        write: { entry: existing, created: false },
      };
    }
    const token = entryToken(input.id, input.at);
    try {
      await batch(this.database, [
        this.database
          .prepare(
            `UPDATE alert_credit_balances
             SET balance_cents = balance_cents - ?,
                 last_entry_token = ?,
                 updated_at = ?
             WHERE workspace_id = ?
               AND balance_cents >= ?
               AND ? > (
                 SELECT COUNT(*)
                 FROM alert_credit_entries AS charge
                 WHERE charge.workspace_id = ?
                   AND charge.kind = 'CHARGE'
                   AND charge.created_at >= ?
                   AND NOT EXISTS (
                     SELECT 1
                     FROM alert_credit_entries AS refund
                     WHERE refund.workspace_id = charge.workspace_id
                       AND refund.kind = 'REFUND'
                       AND refund.delivery_id = charge.delivery_id
                   )
               )`,
          )
          .bind(
            input.amountCents,
            token,
            input.at,
            input.workspaceId,
            input.amountCents,
            dailyLimit,
            input.workspaceId,
            since,
          ),
        this.insertEntryStatement({
          id: input.id,
          workspaceId: input.workspaceId,
          kind: "CHARGE",
          amountCents: -input.amountCents,
          deliveryId: input.deliveryId,
          providerTransactionId: null,
          description: input.description,
          idempotencyKey: input.idempotencyKey,
          at: input.at,
          token,
        }),
      ]);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replayed = await this.findEntryByIdempotencyKey(
        input.idempotencyKey,
      );
      if (replayed === null) throw error;
      return {
        status: "written",
        write: { entry: replayed, created: false },
      };
    }

    const entry = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (entry !== null) {
      return { status: "written", write: { entry, created: true } };
    }
    if ((await this.countCharges(input.workspaceId, since)) >= dailyLimit) {
      return { status: "daily_limit" };
    }
    return { status: "insufficient_credit" };
  }

  async credit(input: CreditCreditInput): Promise<LedgerWrite> {
    const existing = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) return { entry: existing, created: false };
    const token = entryToken(input.id, input.at);
    try {
      await batch(this.database, [
        this.database
          .prepare(
            `INSERT INTO alert_credit_balances
               (workspace_id, balance_cents, last_entry_token, updated_at)
             VALUES (?, 0, NULL, ?)
             ON CONFLICT(workspace_id) DO NOTHING`,
          )
          .bind(input.workspaceId, input.at),
        this.database
          .prepare(
            `UPDATE alert_credit_balances
             SET balance_cents = balance_cents + ?,
                 last_entry_token = ?,
                 updated_at = ?
             WHERE workspace_id = ?`,
          )
          .bind(input.amountCents, token, input.at, input.workspaceId),
        this.insertEntryStatement({
          id: input.id,
          workspaceId: input.workspaceId,
          kind: input.kind,
          amountCents: input.amountCents,
          deliveryId: input.deliveryId,
          providerTransactionId: input.providerTransactionId,
          providerCustomerId: input.providerCustomerId,
          description: input.description,
          idempotencyKey: input.idempotencyKey,
          at: input.at,
          token,
        }),
      ]);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replayed = await this.findEntryByIdempotencyKey(
        input.idempotencyKey,
      );
      if (replayed === null) throw error;
      return { entry: replayed, created: false };
    }
    const entry = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (entry === null) throw new Error("alert credit entry missing after write");
    return { entry, created: true };
  }

  async adjust(input: CreditAdjustmentInput): Promise<LedgerWrite | null> {
    if (input.amountCents === 0) throw new Error("Adjustment cannot be zero");
    const existing = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) return { entry: existing, created: false };
    const token = entryToken(input.id, input.at);
    try {
      await batch(this.database, [
        this.database
          .prepare(
            `INSERT INTO alert_credit_balances
               (workspace_id, balance_cents, last_entry_token, updated_at)
             VALUES (?, 0, NULL, ?)
             ON CONFLICT(workspace_id) DO NOTHING`,
          )
          .bind(input.workspaceId, input.at),
        this.database
          .prepare(
            `UPDATE alert_credit_balances
             SET balance_cents = balance_cents + ?,
                 last_entry_token = ?, updated_at = ?
             WHERE workspace_id = ?
               AND (
                 (? < 0 AND -? <= COALESCE((
                   SELECT topup.amount_cents + COALESCE(SUM(adjustment.amount_cents), 0)
                   FROM alert_credit_entries AS topup
                   LEFT JOIN alert_credit_entries AS adjustment
                     ON adjustment.provider_transaction_id = topup.provider_transaction_id
                    AND adjustment.kind = 'ADJUSTMENT'
                   WHERE topup.provider_transaction_id = ?
                     AND topup.kind = 'TOPUP'
                   GROUP BY topup.id
                 ), 0))
                 OR
                 (? > 0 AND ? <= COALESCE(-(
                   SELECT SUM(adjustment.amount_cents)
                   FROM alert_credit_entries AS adjustment
                   WHERE adjustment.provider_transaction_id = ?
                     AND adjustment.kind = 'ADJUSTMENT'
                 ), 0))
               )`,
          )
          .bind(
            input.amountCents,
            token,
            input.at,
            input.workspaceId,
            input.amountCents,
            input.amountCents,
            input.providerTransactionId,
            input.amountCents,
            input.amountCents,
            input.providerTransactionId,
          ),
        this.insertEntryStatement({
          id: input.id,
          workspaceId: input.workspaceId,
          kind: "ADJUSTMENT",
          amountCents: input.amountCents,
          deliveryId: null,
          providerTransactionId: input.providerTransactionId,
          description: input.description,
          idempotencyKey: input.idempotencyKey,
          at: input.at,
          token,
        }),
      ]);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replayed = await this.findEntryByIdempotencyKey(
        input.idempotencyKey,
      );
      if (replayed === null) throw error;
      return { entry: replayed, created: false };
    }
    const entry = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    return entry === null ? null : { entry, created: true };
  }

  async countCharges(workspaceId: string, since: number): Promise<number> {
    const row = await one<{ count: number }>(
      this.database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM alert_credit_entries AS charge
           WHERE charge.workspace_id = ?
             AND charge.kind = 'CHARGE'
             AND charge.created_at >= ?
             AND NOT EXISTS (
               SELECT 1
               FROM alert_credit_entries AS refund
               WHERE refund.workspace_id = charge.workspace_id
                 AND refund.kind = 'REFUND'
                 AND refund.delivery_id = charge.delivery_id
             )`,
        )
        .bind(workspaceId, since),
    );
    return row?.count ?? 0;
  }

  async listEntries(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<AlertCreditEntry[]> {
    const statement =
      cursor === null || cursor === undefined
        ? this.database
            .prepare(
              `SELECT * FROM alert_credit_entries
               WHERE workspace_id = ?
               ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .bind(workspaceId, limit)
        : this.database
            .prepare(
              `SELECT * FROM alert_credit_entries
               WHERE workspace_id = ?
                 AND (created_at < ? OR (created_at = ? AND id < ?))
               ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .bind(
              workspaceId,
              cursor.createdAt,
              cursor.createdAt,
              cursor.id,
              limit,
            );
    return (await all<EntryRow>(statement)).map(toEntry);
  }

  async listWorkspacesNeedingDefaultChannel(
    limit: number,
  ): Promise<WorkspaceNeedingDefaultChannel[]> {
    const rows = await all<{
      workspace_id: string;
      owner_user_id: string;
      owner_email: string;
    }>(
      this.database
        .prepare(
          `SELECT w.id AS workspace_id, w.owner_user_id, u.email AS owner_email
           FROM workspaces w
           JOIN users u ON u.id = w.owner_user_id
           LEFT JOIN workspace_alert_settings s ON s.workspace_id = w.id
           WHERE w.deleted_at IS NULL
             AND (s.workspace_id IS NULL OR s.default_email_channel_created_at IS NULL)
             AND NOT EXISTS (
               SELECT 1 FROM notification_channels c
               WHERE c.workspace_id = w.id AND c.type <> 'PUSH'
             )
           ORDER BY w.created_at ASC, w.id ASC
           LIMIT ?`,
        )
        .bind(limit),
    );
    return rows.map((row) => ({
      workspaceId: row.workspace_id,
      ownerUserId: row.owner_user_id,
      ownerEmail: row.owner_email,
    }));
  }

  async listWorkspaceIdsNeedingDefaultPushChannel(
    limit: number,
  ): Promise<string[]> {
    const rows = await all<{ workspace_id: string }>(
      this.database
        .prepare(
          `SELECT w.id AS workspace_id
           FROM workspaces w
           LEFT JOIN workspace_alert_settings s ON s.workspace_id = w.id
           WHERE w.deleted_at IS NULL
             AND (s.workspace_id IS NULL OR s.default_push_channel_created_at IS NULL)
           ORDER BY w.created_at ASC, w.id ASC
           LIMIT ?`,
        )
        .bind(limit),
    );
    return rows.map((row) => row.workspace_id);
  }
}
