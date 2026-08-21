import { StartCreditTopUp } from "./start_credit_topup";

describe("StartCreditTopUp", () => {
  it("returns checkout data for the owner", async () => {
    const useCase = new StartCreditTopUp("pri_alert_credit");
    await expect(
      useCase.execute({ workspaceId: "ws_1", actorRole: "OWNER", packs: 3 }),
    ).resolves.toEqual({
      priceId: "pri_alert_credit",
      quantity: 3,
      amountCents: 3_000,
      customData: { workspace_id: "ws_1", purpose: "alert_credit" },
    });
  });

  it("rejects non-owners and invalid pack counts", async () => {
    const useCase = new StartCreditTopUp("pri_alert_credit");
    await expect(
      useCase.execute({ workspaceId: "ws_1", actorRole: "ADMIN", packs: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const packs of [0, 11, 1.5]) {
      await expect(
        useCase.execute({ workspaceId: "ws_1", actorRole: "OWNER", packs }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("is unavailable until the Paddle price is configured", async () => {
    const useCase = new StartCreditTopUp(null);
    await expect(
      useCase.execute({ workspaceId: "ws_1", actorRole: "OWNER", packs: 1 }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
