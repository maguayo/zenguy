import { describe, expect, it, jest } from "@jest/globals";

import type { BillingPlanPrice, SubscriptionStatus, Workspace } from "@/api/types";
import {
  planFeatures,
  planPriceLabel,
  planRetriesNote,
  pollUntilActive,
  workspaceStatus,
} from "./billing-setup";

const workspace = (id: string, subscriptionStatus: SubscriptionStatus): Workspace => ({
  createdAt: "2026-08-19T10:00:00.000Z",
  id,
  name: id,
  role: "OWNER",
  slug: id,
  subscriptionStatus,
  timezone: "UTC",
});
const eurPlan: BillingPlanPrice = {
  currency: "EUR",
  overagePerRunCents: 20,
  pricePerMonthCents: 3_900,
};

describe("billing setup", () => {
  it("keeps the complete plan promise", () => {
    expect(planPriceLabel(eurPlan)).toBe("39,00 €");
    expect(planFeatures(eurPlan)).toEqual([
      "300 browser test runs included",
      "0,20 € per additional run",
      "Unlimited team members",
      "Uptime checks — free, unlimited",
      "30-day run history & evidence",
    ]);
    expect(planPriceLabel({ ...eurPlan, currency: "USD" })).toBe("$39.00");
    expect(planFeatures({ ...eurPlan, currency: "USD" })[1]).toBe(
      "$0.20 per additional run",
    );
    expect(planRetriesNote).toBe("Retries don't consume runs.");
  });

  it("reads the subscription status of the workspace being set up", () => {
    const list = [workspace("ws_1", "NONE"), workspace("ws_2", "ACTIVE")];
    expect(workspaceStatus(list, "ws_2")).toBe("ACTIVE");
    expect(workspaceStatus(list, "ws_1")).toBe("NONE");
    expect(workspaceStatus(list, "ws_9")).toBeNull();
  });

  it("polls until the subscription becomes active", async () => {
    const fetchStatus = jest
      .fn<() => Promise<SubscriptionStatus | null>>()
      .mockResolvedValueOnce("NONE")
      .mockResolvedValueOnce("ACTIVE");
    const wait = jest.fn(async () => undefined);

    await expect(pollUntilActive(fetchStatus, { maxChecks: 3, wait })).resolves.toBe(true);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(2_000);
  });

  it("returns a recoverable timeout after the configured checks", async () => {
    const fetchStatus = jest.fn(async (): Promise<SubscriptionStatus | null> => "NONE");
    const wait = jest.fn(async () => undefined);
    await expect(pollUntilActive(fetchStatus, { maxChecks: 2, wait })).resolves.toBe(false);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
