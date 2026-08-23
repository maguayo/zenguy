import { STALE_DATA_ENCRYPTION_KEY_MARKER } from "../../domain/security/encryption";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { createEncryptionKeyring } from "../../shared/crypto";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeSecretRepo,
  FakeSubscriptionRepo,
} from "../../test/fakes/repos";
import { CreateSecret } from "./create_secret";

const NOW = 1_700_000_000_000;
const OWNER: User = {
  id: "usr_secret_retry",
  name: "Retry Owner",
  email: "retry@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

class OneRotationSecretRepo extends FakeSecretRepo {
  insertAttempts = 0;

  override async insert(secret: Parameters<FakeSecretRepo["insert"]>[0]): Promise<void> {
    this.insertAttempts += 1;
    if (this.insertAttempts === 1) {
      throw new Error(STALE_DATA_ENCRYPTION_KEY_MARKER);
    }
    await super.insert(secret);
  }
}

describe("CreateSecret encrypted write retry", () => {
  it("re-encrypts a fenced write and audits exactly once after persistence", async () => {
    const workspaceId = "ws_secret_retry";
    const secrets = new OneRotationSecretRepo();
    const subscriptions = new FakeSubscriptionRepo();
    await subscriptions.upsertByWorkspace({
      id: "sub_secret_retry",
      workspaceId,
      provider: "internal",
      source: "free",
      providerCustomerId: null,
      providerSubscriptionId: null,
      status: "ACTIVE",
      periodStart: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      updatePaymentUrl: null,
      cancelUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const audits: unknown[] = [];
    const useCase = new CreateSecret(
      secrets,
      subscriptions,
      { execute: async (entry) => void audits.push(entry) },
      createEncryptionKeyring({
        id: "secret-retry-root",
        key: new Uint8Array(32).fill(9),
      }),
      new FixedClock(NOW),
      new FakeIds(),
    );

    await expect(
      useCase.execute({
        workspaceId,
        actor: OWNER,
        actorRole: "OWNER",
        key: "API_TOKEN",
        value: "sensitive",
        allowedDomains: ["example.com"],
      }),
    ).resolves.toMatchObject({ key: "API_TOKEN" });
    expect(secrets.insertAttempts).toBe(2);
    expect(secrets.secrets.size).toBe(1);
    expect(audits).toHaveLength(1);
  });
});
