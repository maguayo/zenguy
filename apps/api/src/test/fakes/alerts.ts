import type {
  AlertRepo,
  AlertSettingsUpdate,
  CreditCreditInput,
  CreditDebitInput,
  LedgerWrite,
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
  workspacesNeedingDefaultChannel: WorkspaceNeedingDefaultChannel[] = [];

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
    return { entry: clone(entry), created: true };
  }

  async countCharges(workspaceId: string, since: number): Promise<number> {
    return this.entries.filter(
      (entry) =>
        entry.workspaceId === workspaceId &&
        entry.kind === "CHARGE" &&
        entry.createdAt >= since,
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
}
