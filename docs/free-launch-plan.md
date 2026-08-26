# Free launch plan (superseded)

Last updated: 2026-08-26

This document records the original free-launch contract. It was superseded by
the Stripe Billing migration on 2026-08-26. Existing `free` and `grant`
subscriptions remain valid; new paid subscriptions require an explicit hosted
Stripe Checkout and are activated only by a verified Stripe webhook.

## Product contract

- Account registration and email verification never request payment details.
- Every new workspace receives an `ACTIVE` subscription with provider
  `internal` and source `free` as part of workspace creation.
- Workspace creation continues directly to Overview; it does not visit billing
  setup.
- The free plan has the same product capabilities and limits as the planned
  paid plan:
  - 300 browser-test runs per UTC calendar month
  - retries do not consume runs
  - unlimited uptime checks
  - unlimited team members
  - 30-day run history and evidence
- Runs beyond 300 remain available and are not billed during the free launch.
- The 300 included runs and monthly usage meter are independent for every
  workspace; they are never pooled across workspaces that share an owner.
- The Plan & Usage page shows the monthly usage cycle and never shows invoices,
  payment-method controls, or cancellation controls for a free workspace.

## Backend behavior

- `GET /api/billing/config` returns `mode: "free"` when Stripe is absent, so
  normal application navigation does not generate a billing 503.
- Free subscriptions have no Stripe customer or subscription identifier and no
  fixed provider period. Usage therefore resets on UTC calendar-month
  boundaries.
- Free periods are excluded from Stripe invoice lookup, management URLs, and
  overage settlement.
- Migration `0018_free_launch_plan.sql` gives the free plan to any existing,
  non-deleted workspace that has no subscription. Existing legacy and grant
  records are deliberately preserved.
- Migration `0043_workspace_run_allowance_scope.sql` removes a historical
  owner-wide 300-run hard stop. Atomic active/daily/monthly safety ceilings for
  workspace, user, owner, and global scopes remain independent anti-abuse
  circuit breakers; they do not reduce or share a workspace's allowance.

## Activating Stripe billing

1. Decide the paid plan, free-to-paid migration policy, price, taxes, trial,
   overage behavior, and effective date.
2. Update the Terms and in-product copy, and give existing users advance
   notice. Never collect or charge a payment method without explicit user
   action.
3. Complete the Stripe test catalog, API key, webhook, Checkout, Customer Portal,
   invoice, cancellation, and idempotency tests.
4. Create separate Stripe live resources and install the complete production
   secret group. Test and live identifiers must never be mixed.
5. Switch the onboarding journey from automatic `free` activation to an
   explicit checkout. A successful signed Stripe webhook may safely replace the
   workspace's internal subscription with source and provider `stripe`.
6. Decide whether existing `free` workspaces remain grandfathered or must opt
   into a paid plan. Do not silently convert them.
7. Verify the full release in staging, then run one explicitly approved Live
   transaction before enabling paid signup generally.

Until those steps are completed, Stripe remains optional and production stays
in free mode.
