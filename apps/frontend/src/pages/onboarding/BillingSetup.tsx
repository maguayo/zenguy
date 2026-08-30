import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  getBilling,
  getBillingConfig,
  startSubscriptionCheckout,
} from "../../api/billing";
import { listMembers } from "../../api/members";
import type { Billing, BillingPlanPrice } from "../../api/types";
import { getWorkspace } from "../../api/workspaces";
import { AuthShell } from "../../components/AuthShell";
import { SignOutButton } from "../../components/SignOutButton";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/ErrorState";
import { Spinner } from "../../components/ui/Spinner";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { apiErrorMessage } from "../../lib/errors";
import { formatCurrency } from "../../lib/format";
import { trustedBillingUrl } from "../../lib/billing-links";
import {
  forgetRememberedSubscriptionCheckout,
  confirmedSubscriptionPurchaseEvent,
  readRememberedSubscriptionCheckout,
  rememberSubscriptionCheckout,
  trackConfirmedSubscriptionPurchase,
  trackSubscriptionCheckoutStarted,
} from "../../lib/analytics/ga4";

type ActivationPhase = "idle" | "opening" | "activating" | "timeout";

export async function pollUntilActiveBilling(
  fetchBilling: () => Promise<Billing>,
  {
    maxChecks = 60,
    wait = (milliseconds: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)),
  }: {
    maxChecks?: number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<Billing | null> {
  for (let check = 0; check < maxChecks; check += 1) {
    const billing = await fetchBilling();
    if (billing.subscription.status === "ACTIVE") return billing;
    if (check < maxChecks - 1) await wait(2_000);
  }
  return null;
}

export async function pollForCorrelatedPurchase(
  initialBilling: Billing,
  fetchBilling: () => Promise<Billing>,
  checkoutStartedAt: number,
  {
    maxChecks = 15,
    now = () => Date.now(),
    wait = (milliseconds: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)),
  }: {
    maxChecks?: number;
    now?: () => number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<Billing | null> {
  let billing = initialBilling;
  for (let check = 0; check < maxChecks; check += 1) {
    if (
      confirmedSubscriptionPurchaseEvent(
        billing,
        checkoutStartedAt,
        now(),
      ) !== null
    ) {
      return billing;
    }
    if (check < maxChecks - 1) {
      await wait(2_000);
      billing = await fetchBilling();
    }
  }
  return null;
}

export async function pollUntilActive(
  fetchBilling: () => Promise<Billing>,
  options?: Parameters<typeof pollUntilActiveBilling>[1],
): Promise<boolean> {
  return (await pollUntilActiveBilling(fetchBilling, options)) !== null;
}

export function shouldCheckCheckoutActivation(
  checkoutResult: string | null,
  billingEnvironment: "test" | "live" | undefined,
): boolean {
  return (
    checkoutResult === "success" &&
    (billingEnvironment === "test" || billingEnvironment === "live")
  );
}

export function PlanDetails({ plan }: { plan: BillingPlanPrice }) {
  const features = [
    "300 browser test runs included",
    `${formatCurrency(plan.overagePerRunCents, plan.currency)} per additional run`,
    "Unlimited team members",
    "Uptime checks — free, unlimited",
    "30-day run history & evidence",
  ];

  return (
    <div>
      <div className="text-center">
        <p className="text-sm font-semibold text-zinc-900">Zenguy</p>
        <p className="mt-2 text-4xl font-semibold tracking-tight text-zinc-950">
          {formatCurrency(plan.pricePerMonthCents, plan.currency)}{" "}
          <span className="text-sm font-normal text-zinc-500">/ month per workspace</span>
        </p>
      </div>
      <ul className="mt-6 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2 text-sm text-zinc-700">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ok-600" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 rounded-md bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-500">
        Retries don't consume runs.
      </p>
    </div>
  );
}

export function ActionErrorNotice({ message }: { message: string }) {
  return (
    <p
      className="mb-3 rounded-md border border-danger-600/20 bg-danger-50 px-3 py-2 text-sm text-danger-700"
      role="alert"
    >
      {message}
    </p>
  );
}

export default function BillingSetup() {
  const { wsId = "" } = useParams();
  const { signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const activationInFlight = useRef(false);
  const [phase, setPhase] = useState<ActivationPhase>("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const workspaceQuery = useQuery({
    enabled: Boolean(wsId),
    queryFn: () => getWorkspace(wsId),
    queryKey: ["ws", wsId],
  });
  const billingConfigQuery = useQuery({
    queryFn: getBillingConfig,
    queryKey: ["billing-config"],
  });
  const isOwner = workspaceQuery.data?.role === "OWNER";
  const membersQuery = useQuery({
    enabled: Boolean(wsId) && workspaceQuery.isSuccess && !isOwner,
    queryFn: () => listMembers(wsId),
    queryKey: ["ws", wsId, "members"],
  });
  const owner = membersQuery.data?.find((member) => member.role === "OWNER");

  const checkActivation = useCallback(async () => {
    if (activationInFlight.current) return;
    activationInFlight.current = true;
    setPhase("activating");
    setActionError(null);
    try {
      const checkoutStartedAt =
        billingConfigQuery.data?.environment === "live"
          ? readRememberedSubscriptionCheckout(wsId)
          : null;
      const confirmedBilling = await pollUntilActiveBilling(() => getBilling(wsId));
      if (confirmedBilling === null) {
        setPhase("timeout");
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["ws", wsId] }),
        queryClient.invalidateQueries({ queryKey: ["ws", wsId, "billing"] }),
      ]);
      if (
        billingConfigQuery.data?.environment === "live" &&
        checkoutStartedAt !== null
      ) {
        // Invoice listing can lag behind subscription activation. Measurement
        // retries in the background and never delays access to the product.
        void pollForCorrelatedPurchase(
          confirmedBilling,
          () => getBilling(wsId),
          checkoutStartedAt,
        )
          .then((billing) => {
            if (billing === null) return;
            trackConfirmedSubscriptionPurchase(billing, checkoutStartedAt);
            forgetRememberedSubscriptionCheckout(wsId);
          })
          .catch(() => undefined);
      }
      toast.success("Subscription active");
      navigate(`/w/${wsId}/overview`, { replace: true });
    } catch (error) {
      setPhase("idle");
      // A blocking action reports failure inline; a transient toast is easy
      // to miss and leaves the page looking like nothing happened.
      setActionError(apiErrorMessage(error));
    } finally {
      activationInFlight.current = false;
    }
  }, [billingConfigQuery.data?.environment, navigate, queryClient, toast, wsId]);

  useEffect(() => {
    if (
      shouldCheckCheckoutActivation(
        searchParams.get("checkout"),
        billingConfigQuery.data?.environment,
      )
    ) {
      void checkActivation();
    }
  }, [billingConfigQuery.data?.environment, checkActivation, searchParams]);

  const startCheckout = async () => {
    let rememberedForAnalytics = false;
    setPhase("opening");
    setActionError(null);
    try {
      const billingConfig = await getBillingConfig();
      const checkout = await startSubscriptionCheckout(wsId);
      const url = trustedBillingUrl(checkout.url);
      if (url === null) {
        throw new Error("The billing provider returned an untrusted link.");
      }
      if (billingConfig.environment === "live") {
        if (
          trackSubscriptionCheckoutStarted({
            currency: checkout.currencyCode,
            pricePerMonthCents: checkout.amountCents,
          })
        ) {
          rememberedForAnalytics = rememberSubscriptionCheckout(wsId);
        }
      }
      window.location.assign(url);
    } catch (error) {
      if (rememberedForAnalytics) {
        forgetRememberedSubscriptionCheckout(wsId);
      }
      setPhase("idle");
      // A blocking action reports failure inline; a transient toast is easy
      // to miss and leaves the page looking like nothing happened.
      setActionError(apiErrorMessage(error));
    }
  };

  if (workspaceQuery.isPending) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading billing setup" size={6} />
      </div>
    );
  }
  if (workspaceQuery.isError) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <ErrorState onRetry={() => void workspaceQuery.refetch()} />
      </main>
    );
  }
  if (!workspaceQuery.data) return <Navigate replace to="/" />;
  if (
    workspaceQuery.data.subscriptionStatus === "ACTIVE" ||
    workspaceQuery.data.subscriptionStatus === "PAST_DUE"
  ) {
    return <Navigate replace to={`/w/${wsId}/overview`} />;
  }
  if (billingConfigQuery.isPending) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading plan" size={6} />
      </div>
    );
  }
  if (billingConfigQuery.isError) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <ErrorState onRetry={() => void billingConfigQuery.refetch()} />
      </main>
    );
  }
  if (!isOwner && membersQuery.isPending) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading workspace owner" size={6} />
      </div>
    );
  }
  if (!isOwner && membersQuery.isError) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <ErrorState onRetry={() => void membersQuery.refetch()} />
      </main>
    );
  }

  const reactivating = workspaceQuery.data.subscriptionStatus === "CANCELED";

  return (
    <AuthShell
      description={
        reactivating
          ? "Add a payment method to start scheduled runs again."
          : "Add a payment method to activate scheduled browser runs."
      }
      footer={<SignOutButton onSignOut={() => void signOut()} />}
      title={reactivating ? "Reactivate your workspace" : "Set up billing"}
    >
      <PlanDetails plan={billingConfigQuery.data.plan} />

      <div className="mt-6">
        {actionError ? <ActionErrorNotice message={actionError} /> : null}
        {phase === "activating" ? (
          <div className="flex items-center justify-center gap-2 rounded-md bg-info-50 px-3 py-3 text-sm font-medium text-info-600">
            <Spinner label="Activating subscription" />
            Activating…
          </div>
        ) : phase === "timeout" ? (
          <div className="rounded-md border border-info-600/20 bg-info-50 p-3 text-sm text-zinc-700">
            <div className="flex gap-2">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info-600" />
              <p>Payment received — activation is taking longer than usual.</p>
            </div>
            <Button className="mt-3 w-full" onClick={() => void checkActivation()}>
              Check again
            </Button>
          </div>
        ) : isOwner ? (
          <Button
            className="w-full"
            loading={phase === "opening"}
            variant="primary"
            onClick={() => void startCheckout()}
          >
            Add payment method
          </Button>
        ) : (
          <div className="rounded-md bg-zinc-50 px-3 py-3 text-center text-sm text-zinc-600">
            <p className="font-medium text-zinc-900">
              Only the workspace owner can set up billing.
            </p>
            {owner ? (
              <p className="mt-1">
                Contact {owner.name} at {owner.email}.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </AuthShell>
  );
}
