import type { User } from "../../domain/users/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1UserRepo } from "./user_repo";
import { D1WorkspaceRepo } from "./workspace_repo";
import { D1PaddleCheckoutIntentRepo } from "./paddle_checkout_intent_repo";

const USER: User = {
  id: "usr_checkout",
  name: "Checkout Owner",
  email: "checkout@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("D1PaddleCheckoutIntentRepo", () => {
  beforeEach(async () => {
    await freshDb();
    await new D1UserRepo(testEnv().DB).insert(USER);
    await new D1WorkspaceRepo(testEnv().DB).insert({
      id: "ws_checkout",
      name: "Checkout",
      slug: "checkout",
      timezone: "UTC",
      ownerUserId: USER.id,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
  });

  it("lets exactly one provider consume a server-pinned intent", async () => {
    const repo = new D1PaddleCheckoutIntentRepo(testEnv().DB);
    await repo.insert({
      id: "pci_checkout",
      workspaceId: "ws_checkout",
      actorUserId: USER.id,
      purpose: "subscription",
      productId: "pro_monthly",
      priceId: "pri_monthly",
      quantity: 1,
      currencyCode: "EUR",
      amountCents: 3_900,
      createdAt: 1_000,
      expiresAt: 10_000,
      consumedAt: null,
      providerReference: null,
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repo.consume("pci_checkout", `sub_${index}`, 2_000),
      ),
    );
    expect(results.filter((result) => result === "consumed")).toHaveLength(1);
    expect(results.filter((result) => result === "unavailable")).toHaveLength(7);
    const consumed = await repo.findById("pci_checkout");
    expect(consumed).toMatchObject({
      productId: "pro_monthly",
      priceId: "pri_monthly",
    });
    expect(consumed?.providerReference).toMatch(/^sub_/u);
    await expect(
      repo.consume("pci_checkout", consumed?.providerReference ?? "", 3_000),
    ).resolves.toBe("replayed");
  });

  it("rejects new intents without a pinned product", async () => {
    const repo = new D1PaddleCheckoutIntentRepo(testEnv().DB);

    await expect(
      repo.insert({
        id: "pci_missing_product",
        workspaceId: "ws_checkout",
        actorUserId: USER.id,
        purpose: "subscription",
        productId: "",
        priceId: "pri_monthly",
        quantity: 1,
        currencyCode: "EUR",
        amountCents: 3_900,
        createdAt: 1_000,
        expiresAt: 10_000,
        consumedAt: null,
        providerReference: null,
      }),
    ).rejects.toThrow("paddle checkout product_id is required");
  });
});
