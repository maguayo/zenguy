import { D1ChannelRepo } from "./channel_repo";
import { D1AlertRepo } from "./alert_repo";
import { D1UserRepo } from "./user_repo";
import { D1WorkspaceRepo } from "./workspace_repo";
import { defaultAlertSettings } from "../../domain/alerts/types";
import { freshDb, testEnv } from "../../test/helpers";

const WS = "ws_alert_repo";

describe("D1AlertRepo", () => {
  let repo: D1AlertRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1AlertRepo(testEnv().DB);
  });

  it("stores settings idempotently and applies partial updates", async () => {
    expect(await repo.findSettings(WS)).toBeNull();
    await repo.insertSettings(defaultAlertSettings(WS, 1_000));
    await repo.insertSettings({
      ...defaultAlertSettings(WS, 2_000),
      paidChannelsEnabled: true,
    });
    expect(await repo.findSettings(WS)).toMatchObject({
      workspaceId: WS,
      paidChannelsEnabled: false,
      dailyPaidAlertLimit: 20,
      defaultEmailChannelCreatedAt: null,
      lowBalanceNotifiedAt: null,
      createdAt: 1_000,
    });

    await repo.updateSettings(WS, { paidChannelsEnabled: true }, 3_000);
    await repo.updateSettings(
      WS,
      { dailyPaidAlertLimit: 5, lowBalanceNotifiedAt: 3_500 },
      4_000,
    );
    expect(await repo.findSettings(WS)).toMatchObject({
      paidChannelsEnabled: true,
      dailyPaidAlertLimit: 5,
      lowBalanceNotifiedAt: 3_500,
      updatedAt: 4_000,
    });
    await repo.updateSettings(WS, { lowBalanceNotifiedAt: null }, 5_000);
    expect((await repo.findSettings(WS))?.lowBalanceNotifiedAt).toBeNull();
  });

  it("credits, debits atomically, and refuses to overdraw", async () => {
    expect(await repo.getBalanceCents(WS)).toBe(0);
    const topup = await repo.credit({
      id: "ace_topup_1",
      workspaceId: WS,
      amountCents: 50,
      kind: "TOPUP",
      idempotencyKey: "paddle_txn:txn_1",
      description: "Top-up",
      deliveryId: null,
      providerTransactionId: "txn_1",
      at: 1_000,
    });
    expect(topup).toMatchObject({
      created: true,
      entry: { kind: "TOPUP", amountCents: 50, balanceAfterCents: 50 },
    });
    expect(await repo.getBalanceCents(WS)).toBe(50);

    const charge = await repo.debit({
      id: "ace_charge_1",
      workspaceId: WS,
      amountCents: 18,
      idempotencyKey: "charge:del_1",
      description: "SMS to Spain",
      deliveryId: "del_1",
      at: 2_000,
    });
    expect(charge).toMatchObject({
      created: true,
      entry: {
        kind: "CHARGE",
        amountCents: -18,
        balanceAfterCents: 32,
        deliveryId: "del_1",
      },
    });
    expect(await repo.getBalanceCents(WS)).toBe(32);

    const overdraw = await repo.debit({
      id: "ace_charge_2",
      workspaceId: WS,
      amountCents: 33,
      idempotencyKey: "charge:del_2",
      description: "Call",
      deliveryId: "del_2",
      at: 3_000,
    });
    expect(overdraw).toBeNull();
    expect(await repo.getBalanceCents(WS)).toBe(32);
    expect(await repo.findEntryByIdempotencyKey("charge:del_2")).toBeNull();

    const missingWorkspace = await repo.debit({
      id: "ace_charge_3",
      workspaceId: "ws_without_balance",
      amountCents: 1,
      idempotencyKey: "charge:del_3",
      description: "SMS",
      deliveryId: "del_3",
      at: 3_000,
    });
    expect(missingWorkspace).toBeNull();
  });

  it("replays idempotency keys without moving the balance", async () => {
    await repo.credit({
      id: "ace_grant_1",
      workspaceId: WS,
      amountCents: 100,
      kind: "GRANT",
      idempotencyKey: "grant:1",
      description: "Grant",
      deliveryId: null,
      providerTransactionId: null,
      at: 1_000,
    });
    const replayedCredit = await repo.credit({
      id: "ace_grant_dup",
      workspaceId: WS,
      amountCents: 100,
      kind: "GRANT",
      idempotencyKey: "grant:1",
      description: "Grant again",
      deliveryId: null,
      providerTransactionId: null,
      at: 1_500,
    });
    expect(replayedCredit.created).toBe(false);
    expect(replayedCredit.entry.id).toBe("ace_grant_1");
    expect(await repo.getBalanceCents(WS)).toBe(100);

    const first = await repo.debit({
      id: "ace_charge_1",
      workspaceId: WS,
      amountCents: 20,
      idempotencyKey: "charge:del_1",
      description: "Call",
      deliveryId: "del_1",
      at: 2_000,
    });
    const replayedDebit = await repo.debit({
      id: "ace_charge_dup",
      workspaceId: WS,
      amountCents: 20,
      idempotencyKey: "charge:del_1",
      description: "Call again",
      deliveryId: "del_1",
      at: 2_500,
    });
    expect(first?.created).toBe(true);
    expect(replayedDebit).toMatchObject({
      created: false,
      entry: { id: "ace_charge_1", balanceAfterCents: 80 },
    });
    expect(await repo.getBalanceCents(WS)).toBe(80);
  });

  it("counts charges in a window and pages the ledger newest first", async () => {
    await repo.credit({
      id: "ace_topup",
      workspaceId: WS,
      amountCents: 1_000,
      kind: "TOPUP",
      idempotencyKey: "topup",
      description: "Top-up",
      deliveryId: null,
      providerTransactionId: null,
      at: 1_000,
    });
    for (const index of [1, 2, 3]) {
      await repo.debit({
        id: `ace_charge_${index}`,
        workspaceId: WS,
        amountCents: 5,
        idempotencyKey: `charge:${index}`,
        description: `SMS ${index}`,
        deliveryId: `del_${index}`,
        at: 1_000 * (index + 1),
      });
    }
    expect(await repo.countCharges(WS, 3_000)).toBe(2);
    expect(await repo.countCharges(WS, 5_000)).toBe(0);
    expect(await repo.countCharges("ws_other", 0)).toBe(0);

    const firstPage = await repo.listEntries(WS, null, 2);
    expect(firstPage.map((entry) => entry.id)).toEqual([
      "ace_charge_3",
      "ace_charge_2",
    ]);
    const last = firstPage.at(-1)!;
    const secondPage = await repo.listEntries(
      WS,
      { createdAt: last.createdAt, id: last.id },
      2,
    );
    expect(secondPage.map((entry) => entry.id)).toEqual([
      "ace_charge_1",
      "ace_topup",
    ]);
  });

  it("lists workspaces that still need their default email channel", async () => {
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const channels = new D1ChannelRepo(bindings.DB);
    await users.insert({
      id: "usr_owner",
      name: "Owner",
      email: "owner@alerts.test",
      passwordHash: "hash",
      emailVerifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const base = {
      slug: "",
      timezone: "UTC",
      ownerUserId: "usr_owner",
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    await workspaces.insert({ ...base, id: "ws_bare", name: "Bare", slug: "bare" });
    await workspaces.insert({
      ...base,
      id: "ws_has_channel",
      name: "Has channel",
      slug: "has-channel",
      createdAt: 2,
    });
    await workspaces.insert({
      ...base,
      id: "ws_marked",
      name: "Marked",
      slug: "marked",
      createdAt: 3,
    });
    await workspaces.insert({
      ...base,
      id: "ws_deleted",
      name: "Deleted",
      slug: "deleted",
      createdAt: 4,
      deletedAt: 5,
    });
    await channels.insert({
      id: "ch_existing",
      workspaceId: "ws_has_channel",
      name: "Slack",
      type: "SLACK",
      encryptedConfig: "enc",
      enabled: true,
      verifiedAt: null,
      lastDeliveryStatus: null,
      createdBy: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.insertSettings({
      ...defaultAlertSettings("ws_marked", 1),
      defaultEmailChannelCreatedAt: 1,
    });

    expect(await repo.listWorkspacesNeedingDefaultChannel(10)).toEqual([
      {
        workspaceId: "ws_bare",
        ownerUserId: "usr_owner",
        ownerEmail: "owner@alerts.test",
      },
    ]);
  });
});
