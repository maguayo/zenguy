import type { BillingPlanPrice, SubscriptionStatus, Workspace } from "@/api/types";
import { formatCurrency } from "@/lib/format";

export function planFeatures(plan: BillingPlanPrice): string[] {
  return [
    "300 browser test runs included",
    `${formatCurrency(plan.overagePerRunCents, plan.currency)} per additional run`,
    "Unlimited team members",
    "Uptime checks — free, unlimited",
    "30-day run history & evidence",
  ];
}

export function planPriceLabel(plan: BillingPlanPrice): string {
  return formatCurrency(plan.pricePerMonthCents, plan.currency);
}
export const planPriceSuffix = "/ month per workspace";
export const planRetriesNote = "Retries don't consume runs.";

export const stripeActivationTimeoutMessage =
  "Activation is taking longer than usual. Check again once the payment is confirmed on the web.";

export function workspaceStatus(
  workspaces: Workspace[],
  workspaceId: string,
): SubscriptionStatus | null {
  return workspaces.find((workspace) => workspace.id === workspaceId)?.subscriptionStatus ?? null;
}

/** Re-checks the subscription every 2 s; 60 checks ≈ 2 minutes. */
export async function pollUntilActive(
  fetchStatus: () => Promise<SubscriptionStatus | null>,
  {
    maxChecks = 60,
    wait = (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  }: {
    maxChecks?: number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  for (let check = 0; check < maxChecks; check += 1) {
    if ((await fetchStatus()) === "ACTIVE") return true;
    if (check < maxChecks - 1) await wait(2_000);
  }
  return false;
}
