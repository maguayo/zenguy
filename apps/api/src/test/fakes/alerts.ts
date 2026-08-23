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
  AlertSettings,
} from "../../domain/alerts/types";
import type { Cursor } from "../../shared/pagination";

function clone<T extends object>(value: T): T {
  return { ...value };
}

export class FakeAlertRepo implements AlertRepo {
  readonly settings = new Map<string, AlertSettings>();
  readonly balances = new Map<string, number>();
  readonly entries: AlertCreditEntry[] = [];
  readonly reconciledTopups = new Map<string, number>();
  readonly paddleTopupCustomers = new Map<string, string | null>();
  workspacesNeedingDefaultChannel: WorkspaceNeedingDefaultChannel[] = [];
  workspaceIdsNeedingDefaultPushChannel: string[] = [];

  async findSettings(workspaceId: string): Promise<AlertSettings | null> {
    const settings = this.settings.get(workspaceId);
    return settings === undefined ? null : clone(settings);
  }

  async insertSettings(settings: AlertSettings): Promise<void> {
    if (!this.settings.has(settings.workspaceId)) {
      this.settings.set(settings.workspaceId, clone(settings));
    }
  }

  async updateSettings(
    workspaceId: string,
    changes: AlertSettingsUpdate,
    at: number,
  ): Promise<void> {
    const settings = this.settings.get(workspaceId);
    if (settings === undefined) return;
    this.settings.set(workspaceId, {
      ...settings,
      ...(changes.paidChannelsEnabled === undefined
        ? {}
        : { paidChannelsEnabled: changes.paidChannelsEnabled }),
      ...(changes.dailyPaidAlertLimit === undefined
        ? {}
        : { dailyPaidAlertLimit: changes.dailyPaidAlertLimit }),
      ...(changes.defaultEmailChannelCreatedAt === undefined
        ? {}
        : { defaultEmailChannelCreatedAt: changes.defaultEmailChannelCreatedAt }),
      ...(changes.defaultPushChannelCreatedAt === undefined
        ? {}
        : { defaultPushChannelCreatedAt: changes.defaultPushChannelCreatedAt }),
      ...(changes.lowBalanceNotifiedAt === undefined
        ? {}
        : { lowBalanceNotifiedAt: changes.lowBalanceNotifiedAt }),
      updatedAt: at,
    });
  }

  async getBalanceCents(workspaceId: string): Promise<number> {
    return this.balances.get(workspaceId) ?? 0;
  }

  setBalance(workspaceId: string, cents: number): void {
    this.balances.set(workspaceId, cents);
  }

  async findEntryByIdempotencyKey(
    key: string,
  ): Promise<AlertCreditEntry | null> {
    const entry = this.entries.find((candidate) => candidate.idempotencyKey === key);
    return entry === undefined ? null : clone(entry);
  }

  async findTopupByProviderTransactionId(
    id: string,
  ): Promise<PaddleTopupForReconciliation | null> {
    const entry = this.entries.find(
      (candidate) =>
        candidate.providerTransactionId === id && candidate.kind === "TOPUP",
    );
    return entry === undefined
      ? null
      : {
          workspaceId: entry.workspaceId,
          providerTransactionId: id,
          providerCustomerId: this.paddleTopupCustomers.get(id) ?? null,
          amountCents: entry.amountCents,
        };
  }

  async listTopupsNeedingReconciliation(
    reconciledBefore: number,
    limit: number,
  ): Promise<PaddleTopupForReconciliation[]> {
    return this.entries
      .filter(
        (entry) =>
          entry.kind === "TOPUP" &&
          entry.providerTransactionId !== null &&
          (this.reconciledTopups.get(entry.providerTransactionId) ?? 0) <
            reconciledBefore,
      )
      .slice(0, limit)
      .map((entry) => ({
        workspaceId: entry.workspaceId,
        providerTransactionId: entry.providerTransactionId!,
        providerCustomerId:
          this.paddleTopupCustomers.get(entry.providerTransactionId!) ?? null,
        amountCents: entry.amountCents,
      }));
  }

  async markTopupReconciled(
    providerTransactionId: string,
    at: number,
  ): Promise<void> {
    this.reconciledTopups.set(providerTransactionId, at);
  }

  async debit(input: CreditDebitInput): Promise<LedgerWrite | null> {
    const existing = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) return { entry: existing, created: false };
    const balance = this.balances.get(input.workspaceId) ?? 0;
    if (balance < input.amountCents) return null;
    const after = balance - input.amountCents;
    this.balances.set(input.workspaceId, after);
    const entry: AlertCreditEntry = {
      id: input.id,
      workspaceId: input.workspaceId,
      kind: "CHARGE",
      amountCents: -input.amountCents,
      balanceAfterCents: after,
      deliveryId: input.deliveryId,
      providerTransactionId: null,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.at,
    };
    this.entries.push(entry);
    return { entry: clone(entry), created: true };
  }

  async debitWithinDailyLimit(
    input: CreditDebitInput,
    dailyLimit: number,
    since: number,
  ): Promise<LimitedDebitResult> {
    const existing = this.entries.find(
      (entry) => entry.idempotencyKey === input.idempotencyKey,
    );
    if (existing !== undefined) {
      return {
        status: "written",
        write: { entry: clone(existing), created: false },
      };
    }
    const refundedDeliveries = new Set(
      this.entries
        .filter(
          (entry) =>
            entry.workspaceId === input.workspaceId && entry.kind === "REFUND",
        )
        .map((entry) => entry.deliveryId),
    );
    const activeCharges = this.entries.filter(
      (entry) =>
        entry.workspaceId === input.workspaceId &&
        entry.kind === "CHARGE" &&
        entry.createdAt >= since &&
        !refundedDeliveries.has(entry.deliveryId),
    ).length;
    if (activeCharges >= dailyLimit) return { status: "daily_limit" };
    const balance = this.balances.get(input.workspaceId) ?? 0;
    if (balance < input.amountCents) return { status: "insufficient_credit" };
    const after = balance - input.amountCents;
    this.balances.set(input.workspaceId, after);
    const entry: AlertCreditEntry = {
      id: input.id,
      workspaceId: input.workspaceId,
      kind: "CHARGE",
      amountCents: -input.amountCents,
      balanceAfterCents: after,
      deliveryId: input.deliveryId,
      providerTransactionId: null,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.at,
    };
    this.entries.push(entry);
    return {
      status: "written",
      write: { entry: clone(entry), created: true },
    };
  }

  async credit(input: CreditCreditInput): Promise<LedgerWrite> {
    const existing = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) return { entry: existing, created: false };
    const after = (this.balances.get(input.workspaceId) ?? 0) + input.amountCents;
    this.balances.set(input.workspaceId, after);
    const entry: AlertCreditEntry = {
      id: input.id,
      workspaceId: input.workspaceId,
      kind: input.kind,
      amountCents: input.amountCents,
      balanceAfterCents: after,
      deliveryId: input.deliveryId,
      providerTransactionId: input.providerTransactionId,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.at,
    };
    this.entries.push(entry);
    if (input.kind === "TOPUP" && input.providerTransactionId !== null) {
      this.paddleTopupCustomers.set(
        input.providerTransactionId,
        input.providerCustomerId ?? null,
      );
    }
    return { entry: clone(entry), created: true };
  }

  async adjust(input: CreditAdjustmentInput): Promise<LedgerWrite | null> {
    const existing = this.entries.find(
      (entry) => entry.idempotencyKey === input.idempotencyKey,
    );
    if (existing !== undefined) {
      return { entry: clone(existing), created: false };
    }
    if (input.amountCents === 0) throw new Error("Adjustment cannot be zero");
    {
      const topup = this.entries.find(
        (entry) =>
          entry.kind === "TOPUP" &&
          entry.providerTransactionId === input.providerTransactionId,
      );
      const prior = this.entries
        .filter(
          (entry) =>
            entry.kind === "ADJUSTMENT" &&
            entry.providerTransactionId === input.providerTransactionId,
        )
        .reduce((total, entry) => total + entry.amountCents, 0);
      if (
        topup === undefined ||
        (input.amountCents < 0 &&
          -input.amountCents > topup.amountCents + prior) ||
        (input.amountCents > 0 && input.amountCents > -prior)
      ) {
        return null;
      }
    }
    const after = (this.balances.get(input.workspaceId) ?? 0) + input.amountCents;
    this.balances.set(input.workspaceId, after);
    const entry: AlertCreditEntry = {
      id: input.id,
      workspaceId: input.workspaceId,
      kind: "ADJUSTMENT",
      amountCents: input.amountCents,
      balanceAfterCents: after,
      deliveryId: null,
      providerTransactionId: input.providerTransactionId,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.at,
    };
    this.entries.push(entry);
    return { entry: clone(entry), created: true };
  }

  async countCharges(workspaceId: string, since: number): Promise<number> {
    const refundedDeliveries = new Set(
      this.entries
        .filter(
          (entry) =>
            entry.workspaceId === workspaceId && entry.kind === "REFUND",
        )
        .map((entry) => entry.deliveryId),
    );
    return this.entries.filter(
      (entry) =>
        entry.workspaceId === workspaceId &&
        entry.kind === "CHARGE" &&
        entry.createdAt >= since &&
        !refundedDeliveries.has(entry.deliveryId),
    ).length;
  }

  async listEntries(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<AlertCreditEntry[]> {
    return this.entries
      .filter(
        (entry) =>
          entry.workspaceId === workspaceId &&
          (cursor === null ||
            cursor === undefined ||
            entry.createdAt < cursor.createdAt ||
            (entry.createdAt === cursor.createdAt && entry.id < cursor.id)),
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .slice(0, limit)
      .map(clone);
  }

  async listWorkspacesNeedingDefaultChannel(
    limit: number,
  ): Promise<WorkspaceNeedingDefaultChannel[]> {
    return this.workspacesNeedingDefaultChannel.slice(0, limit).map(clone);
  }

  async listWorkspaceIdsNeedingDefaultPushChannel(
    limit: number,
  ): Promise<string[]> {
    return this.workspaceIdsNeedingDefaultPushChannel.slice(0, limit);
  }
}
