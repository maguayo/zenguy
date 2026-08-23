import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { getBilling } from "@/api/billing";
import type { Billing } from "@/api/types";
import { AccessDenied } from "@/components/more/AccessDenied";
import {
  invoiceNumberLabel,
  invoiceStatus,
  paymentOwnerOnlyNote,
  paymentWebNote,
  planPresentation,
  planPrice,
  subscriptionPeriod,
} from "@/components/more/billing";
import { UsageMeter } from "@/components/UsageMeter";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatDateTime, formatEuros } from "@/lib/format";
import { colors, palette, radius, spacing } from "@/theme";
import {
  Badge,
  Button,
  Caption,
  Card,
  DescriptionList,
  EmptyState,
  ErrorState,
  IconTile,
  ListRow,
  Mono,
  Muted,
  Screen,
  Skeleton,
  Small,
  Title,
} from "@/ui";

function BillingSkeleton() {
  return (
    <View accessibilityLabel="Loading billing" style={styles.stack}>
      {[0, 1].map((index) => (
        <Card key={index}>
          <Skeleton width={90} />
          <Skeleton height={24} style={styles.gapTop} width={180} />
          <View style={[styles.gapTop, styles.skeletonRows]}>
            <Skeleton />
            <Skeleton width="75%" />
          </View>
        </Card>
      ))}
    </View>
  );
}

function PlanCard({ billing, timezone }: { billing: Billing; timezone: string }) {
  const router = useRouter();
  const { current } = useWorkspace();
  const plan = planPresentation(billing.subscription.source, billing.subscription.status);
  const period = subscriptionPeriod(billing);
  const needsSetup =
    plan.paid &&
    (billing.subscription.status === "NONE" || billing.subscription.status === "CANCELED");

  return (
    <Card elevated eyebrow="Plan">
      <View style={styles.planHeader}>
        <Title style={styles.planName}>{plan.name}</Title>
        <Badge dot size="md" tone={plan.tone}>
          {plan.label}
        </Badge>
      </View>
      <Muted style={styles.planDescription}>{plan.description}</Muted>
      <DescriptionList
        items={[
          { label: "Price", value: <Mono>{planPrice(plan, billing.plan.pricePerMonthCents)}</Mono> },
          { label: "Included runs", value: <Mono>{`${billing.plan.includedRuns} runs per month`}</Mono> },
          {
            label: "Period",
            value: (
              <Mono>{`${formatDateTime(period.start, timezone)} – ${formatDateTime(period.end, timezone)}`}</Mono>
            ),
          },
        ]}
      />
      {billing.subscription.cancelAtPeriodEnd && billing.subscription.periodEnd ? (
        <View style={styles.notice}>
          <Small color={colors.warn}>
            Your subscription ends on {formatDateTime(billing.subscription.periodEnd, timezone)}.
          </Small>
        </View>
      ) : null}
      {needsSetup ? (
        <Button
          style={styles.gapTop}
          title="Set up subscription"
          variant="accent"
          onPress={() => router.push(`/w/${current.id}/setup/billing`)}
        />
      ) : null}
    </Card>
  );
}

function UsageCard({ billing, timezone }: { billing: Billing; timezone: string }) {
  return (
    <Card eyebrow="Usage">
      <UsageMeter timezone={timezone} usage={billing.usage} />
      <Caption style={styles.gapTop}>
        Current period: {formatDateTime(billing.usage.periodStart, timezone)} –{" "}
        {formatDateTime(billing.usage.periodEnd, timezone)}
      </Caption>
    </Card>
  );
}

function InvoicesCard({ billing, timezone }: { billing: Billing; timezone: string }) {
  return (
    <Card eyebrow="Invoices" padding="none">
      {billing.invoices.length === 0 ? (
        <EmptyState icon={<IconTile icon="file-text" size={44} />} title="No invoices yet." />
      ) : (
        billing.invoices.map((invoice, index) => {
          const display = invoiceStatus(invoice.status);
          return (
            <ListRow
              key={invoice.id}
              left={<IconTile icon="file-text" />}
              meta={invoice.billedAt ? formatDateTime(invoice.billedAt, timezone) : "—"}
              right={
                <View style={styles.invoiceRight}>
                  <Mono style={styles.invoiceTotal}>{formatEuros(invoice.totalCents)}</Mono>
                  <Badge tone={display.tone}>{display.label}</Badge>
                </View>
              }
              style={index === billing.invoices.length - 1 ? styles.lastRow : undefined}
              title={invoiceNumberLabel(invoice)}
            />
          );
        })
      )}
    </Card>
  );
}

function PaymentCard({ canManage }: { canManage: boolean }) {
  return (
    <Card eyebrow="Payment">
      <Muted>{canManage ? paymentWebNote : paymentOwnerOnlyNote}</Muted>
    </Card>
  );
}

export default function BillingScreen() {
  const { can, current, timezone } = useWorkspace();
  const allowed = can("billing.view");
  const billing = useQuery({
    enabled: allowed,
    queryFn: () => getBilling(current.id),
    queryKey: ["ws", current.id, "billing"],
  });

  return (
    <>
      <Stack.Screen options={{ title: "Plan & Usage" }} />
      <Screen
        refreshing={allowed && billing.isRefetching && !billing.isPending}
        onRefresh={allowed ? () => void billing.refetch() : undefined}
      >
        {!allowed ? (
          <AccessDenied message="Only owners and admins can view billing." />
        ) : billing.isPending ? (
          <BillingSkeleton />
        ) : billing.isError ? (
          <ErrorState onRetry={() => void billing.refetch()} />
        ) : (
          <View style={styles.stack}>
            <PlanCard billing={billing.data} timezone={timezone} />
            <UsageCard billing={billing.data} timezone={timezone} />
            {planPresentation(billing.data.subscription.source, billing.data.subscription.status)
              .paid ? (
              <>
                <InvoicesCard billing={billing.data} timezone={timezone} />
                <PaymentCard canManage={can("billing.manage")} />
              </>
            ) : null}
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  gapTop: { marginTop: spacing.lg },
  invoiceRight: { alignItems: "flex-end", gap: spacing.xs },
  invoiceTotal: { fontWeight: "500" },
  lastRow: { borderBottomWidth: 0 },
  notice: {
    backgroundColor: colors.warnSoft,
    borderColor: palette.amberLine,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  planDescription: { marginBottom: spacing.md, marginTop: spacing.sm },
  planHeader: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  planName: { flexShrink: 1 },
  skeletonRows: { gap: spacing.sm },
  stack: { gap: spacing.xl },
});
