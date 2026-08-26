import { Hono } from "hono";
import { cors } from "hono/cors";
import type { EmailSender } from "./domain/email/sender";
import type { ActivityEventRepo } from "./domain/activity/repo";
import type { AuditRepo } from "./domain/audit/repo";
import type { BillingCanceller } from "./domain/billing/canceller";
import type { ChannelSender } from "./domain/channels/notifier";
import type {
  ChannelRepo,
  DeliveryRepo,
} from "./domain/channels/repo";
import type {
  ArtifactRepo,
  AttemptRepo,
  BrowserTestRepo,
  RunRepo,
  StepRepo,
} from "./domain/browser_tests/repo";
import type { AttemptMessage, CheckMessage, NotifyMessage } from "./domain/queues";
import type { IncidentCloserOnDelete } from "./application/browser_tests/incident_closer";
import { CloseIncidentOnTestDelete } from "./application/incidents/close_incident_on_test_delete";
import type {
  IncidentEventRepo,
  IncidentRepo,
} from "./domain/incidents/repo";
import type { MonitorConfig } from "./domain/uptime/rules";
import type { CheckRepo, MonitorRepo } from "./domain/uptime/repo";
import type { OverviewRepo } from "./domain/overview/repo";
import type { CheckOutcome } from "./application/uptime/execute_check";
import { executeCheck } from "./application/uptime/execute_check";
import { ResolveSecrets } from "./application/secrets/resolve_secrets";
import type { SecretRepo } from "./domain/secrets/repo";
import type { EncryptionRotationRepo } from "./domain/security/encryption";
import type {
  CheckoutIntentRepo,
  OverageReportRepo,
  PendingOveragePeriodRepo,
  SubscriptionGrantRepo,
  SubscriptionRepo,
  UsageEventRepo,
} from "./domain/billing/repo";
import type { PeriodOverageReporter } from "./application/billing/handle_paddle_webhook";
import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  SessionSecurityRepo,
  UserRepo,
} from "./domain/users/repo";
import type {
  InvitationRepo,
  MemberRepo,
  WorkspaceRepo,
} from "./domain/workspaces/repo";
import type { AppEnv } from "./http/env";
import type { WorkspaceDeletionCoordinator } from "./application/workspaces/delete_workspace";
import { WorkspaceDeletionSaga } from "./application/workspaces/workspace_deletion_saga";
import { errorHandler } from "./http/middleware/error_handler";
import { requestId } from "./http/middleware/request_id";
import { securityHeaders } from "./http/middleware/security_headers";
import { authRoutes } from "./http/routes/auth";
import { workspaceRoutes } from "./http/routes/workspaces";
import {
  publicInvitationRoutes,
  workspaceInvitationRoutes,
} from "./http/routes/invitations";
import { memberRoutes } from "./http/routes/members";
import { TrackEvent } from "./application/activity/track_event";
import { WriteAudit } from "./application/audit/write_audit";
import { D1ActivityEventRepo } from "./infrastructure/db/activity_event_repo";
import { D1AuditRepo } from "./infrastructure/db/audit_repo";
import { D1EmailTokenRepo } from "./infrastructure/db/email_token_repo";
import { D1RefreshTokenRepo } from "./infrastructure/db/refresh_token_repo";
import { D1UserRepo } from "./infrastructure/db/user_repo";
import { D1SessionSecurityRepo } from "./infrastructure/db/session_security_repo";
import { D1MemberRepo } from "./infrastructure/db/member_repo";
import { D1WorkspaceRepo } from "./infrastructure/db/workspace_repo";
import { D1WorkspaceDeletionRepo } from "./infrastructure/db/workspace_deletion_repo";
import { D1InvitationRepo } from "./infrastructure/db/invitation_repo";
import { D1SubscriptionRepo } from "./infrastructure/db/subscription_repo";
import { D1PaddleCheckoutIntentRepo } from "./infrastructure/db/paddle_checkout_intent_repo";
import { D1StripeCheckoutIntentRepo } from "./infrastructure/db/stripe_checkout_intent_repo";
import { D1SubscriptionGrantRepo } from "./infrastructure/db/subscription_grant_repo";
import { D1UsageEventRepo } from "./infrastructure/db/usage_event_repo";
import { D1OverageReportRepo } from "./infrastructure/db/overage_report_repo";
import {
  D1PendingOveragePeriodRepo,
} from "./infrastructure/db/pending_overage_period_repo";
import { D1SecretRepo } from "./infrastructure/db/secret_repo";
import { D1EncryptionRotationRepo } from "./infrastructure/db/encryption_rotation_repo";
import { D1ChannelRepo } from "./infrastructure/db/channel_repo";
import { D1DeliveryRepo } from "./infrastructure/db/delivery_repo";
import { D1BrowserTestRepo } from "./infrastructure/db/browser_test_repo";
import { D1RunRepo } from "./infrastructure/db/run_repo";
import { D1AttemptRepo } from "./infrastructure/db/attempt_repo";
import { D1StepRepo } from "./infrastructure/db/step_repo";
import { D1ArtifactRepo } from "./infrastructure/db/artifact_repo";
import { D1IncidentEventRepo } from "./infrastructure/db/incident_event_repo";
import { D1IncidentRepo } from "./infrastructure/db/incident_repo";
import { D1MonitorRepo } from "./infrastructure/db/monitor_repo";
import { D1CheckRepo } from "./infrastructure/db/check_repo";
import { D1OverviewRepo } from "./infrastructure/db/overview_repo";
import { D1DurableWorkflowRepo } from "./infrastructure/db/durable_workflow_repo";
import { ArtifactStorage } from "./infrastructure/storage/artifacts";
import { PaddleBillingCanceller } from "./infrastructure/paddle/billing_canceller";
import { NoopBillingCanceller } from "./infrastructure/billing/noop";
import {
  HttpPaddleClient,
  type PaddleClient,
} from "./infrastructure/paddle/client";
import { UnavailablePaddleClient } from "./infrastructure/paddle/unavailable";
import { HttpStripeClient } from "./infrastructure/stripe/client";
import type { BillingProviderClient } from "./infrastructure/billing/provider";
import { buildEmailSender } from "./infrastructure/email";
import { stripeWebhookRoutes, webhookRoutes } from "./http/routes/webhooks";
import { billingRoutes } from "./http/routes/billing";
import { subscriptionGrantRoutes } from "./http/routes/subscription_grants";
import { secretRoutes } from "./http/routes/secrets";
import { channelRoutes } from "./http/routes/channels";
import { incidentRoutes } from "./http/routes/incidents";
import { browserTestRoutes } from "./http/routes/browser_tests";
import { artifactRoutes } from "./http/routes/artifacts";
import { appVersionRoutes } from "./http/routes/app_version";
import { runEventRoutes } from "./http/routes/run_events";
import { uptimeRoutes } from "./http/routes/uptime";
import { overviewRoutes } from "./http/routes/overview";
import { auditRoutes } from "./http/routes/audit";
import { apiKeyRoutes } from "./http/routes/api_keys";
import { publicApiRoutes } from "./http/routes/public_api";
import { runnerRoutes } from "./http/routes/runner";
import type { RunnerWorkerRepo } from "./domain/runners/repo";
import { D1RunnerWorkerRepo } from "./infrastructure/db/runner_worker_repo";
import type { ApiKeyRepo } from "./domain/api_keys/repo";
import type { AlertRepo } from "./domain/alerts/repo";
import { D1AlertRepo } from "./infrastructure/db/alert_repo";
import { ChargePaidDelivery } from "./application/alerts/charge_paid_delivery";
import { EnsureDefaultEmailChannel } from "./application/alerts/ensure_default_email_channel";
import { alertRoutes } from "./http/routes/alerts";
import type { PushDeviceRepo } from "./domain/push/repo";
import { D1PushDeviceRepo } from "./infrastructure/db/push_device_repo";
import { EnsureDefaultPushChannel } from "./application/push/ensure_default_push_channel";
import {
  MAX_API_REQUEST_BODY_BYTES,
  MAX_BROWSER_TEST_IMPORT_BODY_BYTES,
  MAX_PADDLE_WEBHOOK_BODY_BYTES,
  MAX_STRIPE_WEBHOOK_BODY_BYTES,
  MAX_STANDARD_API_REQUEST_BODY_BYTES,
} from "./shared/constants";
import { strictBodyLimit } from "./http/middleware/strict_body_limit";
import { activityRoutes } from "./http/routes/activity";
import { pushDeviceRoutes } from "./http/routes/push_devices";
import { D1ApiKeyRepo } from "./infrastructure/db/api_key_repo";
import { buildChannelSender } from "./infrastructure/notify";
import { ReportOverageForPeriod } from "./application/billing/report_overage_for_period";
import { RecordRunUsage } from "./application/billing/record_run_usage";
import { ReverseRunUsage } from "./application/billing/reverse_run_usage";
import { DispatchNotifications } from "./application/channels/dispatch_notifications";
import { AttemptLifecycle } from "./application/execution/attempt_lifecycle";
import { ExternalRunner } from "./application/execution/external_runner";
import { HandleRunFinalized } from "./application/incidents/handle_run_finalized";
import { GenerateReport } from "./application/reports/generate_report";
import type { Clock } from "./shared/clock";
import { systemClock } from "./shared/clock";
import { loadConfig, type Bindings } from "./shared/config";
import {
  resolveAttemptDispatch,
  type AttemptDispatch,
} from "./application/execution/attempt_dispatch";
import type { IdGenerator } from "./shared/ids";
import { realIds } from "./shared/ids";
import { D1RateLimiter, type RateLimiter } from "./shared/ratelimit";
import { PublishQueueOutbox } from "./application/durability/publish_outbox";

export interface AppOverrides {
  clock?: Clock;
  ids?: IdGenerator;
  users?: UserRepo;
  emailTokens?: EmailTokenRepo;
  refreshTokens?: RefreshTokenRepo;
  sessionSecurity?: SessionSecurityRepo;
  emailSender?: EmailSender;
  rateLimiter?: RateLimiter;
  workspaces?: WorkspaceRepo;
  members?: MemberRepo;
  audits?: AuditRepo;
  activityEvents?: ActivityEventRepo;
  invitations?: InvitationRepo;
  subscriptions?: SubscriptionRepo;
  checkoutIntents?: CheckoutIntentRepo;
  subscriptionGrants?: SubscriptionGrantRepo;
  usageEvents?: UsageEventRepo;
  overageReports?: OverageReportRepo;
  pendingOveragePeriods?: PendingOveragePeriodRepo;
  secrets?: SecretRepo;
  encryptionRotation?: EncryptionRotationRepo;
  channels?: ChannelRepo;
  deliveries?: DeliveryRepo;
  channelSender?: ChannelSender;
  browserTests?: BrowserTestRepo;
  runs?: RunRepo;
  attempts?: AttemptRepo;
  steps?: StepRepo;
  artifacts?: ArtifactRepo;
  artifactStorage?: Pick<ArtifactStorage, "put" | "get" | "delete">;
  incidents?: IncidentRepo;
  incidentEvents?: IncidentEventRepo;
  monitors?: MonitorRepo;
  checks?: CheckRepo;
  overview?: OverviewRepo;
  uptimeCheckExecutor?: (
    config: MonitorConfig,
    workspaceId: string,
    execution?: { idempotencyKey?: string },
  ) => Promise<CheckOutcome>;
  incidentCloserOnTestDelete?: IncidentCloserOnDelete;
  runQueue?: AttemptDispatch;
  paddleClient?: PaddleClient;
  billingClient?: BillingProviderClient;
  stripeClient?: HttpStripeClient;
  overageReporter?: PeriodOverageReporter;
  billingCanceller?: BillingCanceller;
  workspaceDeletion?: WorkspaceDeletionCoordinator;
  apiKeys?: ApiKeyRepo;
  alerts?: AlertRepo;
  pushDevices?: PushDeviceRepo;
  externalRunner?: Pick<
    ExternalRunner,
    | "claim"
    | "claimStale"
    | "start"
    | "authorizeAction"
    | "recordStep"
    | "complete"
  >;
  runnerWorkers?: RunnerWorkerRepo;
}

export function buildApp(
  env: Bindings,
  overrides: AppOverrides = {},
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const config = loadConfig(env);
  const clock = overrides.clock ?? systemClock;
  const users = overrides.users ?? new D1UserRepo(env.DB);
  const emailTokens =
    overrides.emailTokens ?? new D1EmailTokenRepo(env.DB);
  const refreshTokens =
    overrides.refreshTokens ?? new D1RefreshTokenRepo(env.DB);
  const sessionSecurity =
    overrides.sessionSecurity ?? new D1SessionSecurityRepo(env.DB);
  const emailSender =
    overrides.emailSender ?? buildEmailSender(config, env.EMAIL);
  const rateLimiter =
    overrides.rateLimiter ?? new D1RateLimiter(env.DB, clock);
  const workspaces = overrides.workspaces ?? new D1WorkspaceRepo(env.DB);
  const members = overrides.members ?? new D1MemberRepo(env.DB);
  const audits = overrides.audits ?? new D1AuditRepo(env.DB);
  const activityEvents =
    overrides.activityEvents ?? new D1ActivityEventRepo(env.DB);
  const track = new TrackEvent({
    activity: activityEvents,
    clock,
    ids: overrides.ids ?? realIds,
  });
  const invitations =
    overrides.invitations ?? new D1InvitationRepo(env.DB);
  const subscriptions =
    overrides.subscriptions ?? new D1SubscriptionRepo(env.DB);
  const checkoutIntents =
    overrides.checkoutIntents ??
    (config.stripe === null
      ? new D1PaddleCheckoutIntentRepo(env.DB)
      : new D1StripeCheckoutIntentRepo(env.DB));
  const subscriptionGrants =
    overrides.subscriptionGrants ?? new D1SubscriptionGrantRepo(env.DB);
  const usageEvents = overrides.usageEvents ?? new D1UsageEventRepo(env.DB);
  const overageReports =
    overrides.overageReports ?? new D1OverageReportRepo(env.DB);
  const pendingOveragePeriods =
    overrides.pendingOveragePeriods ??
    new D1PendingOveragePeriodRepo(env.DB);
  const secrets = overrides.secrets ?? new D1SecretRepo(env.DB);
  const encryptionRotation =
    overrides.encryptionRotation ?? new D1EncryptionRotationRepo(env.DB);
  const resolveSecrets = new ResolveSecrets(secrets, config.encryptionKeys);
  const channels = overrides.channels ?? new D1ChannelRepo(env.DB);
  const deliveries = overrides.deliveries ?? new D1DeliveryRepo(env.DB);
  const pushDevices = overrides.pushDevices ?? new D1PushDeviceRepo(env.DB);
  const channelSender =
    overrides.channelSender ??
    buildChannelSender(config, emailSender, fetch, {
      devices: pushDevices,
      appUrl: config.appUrl,
      accessToken: config.expoPushAccessToken,
      clock,
    });
  const browserTests =
    overrides.browserTests ?? new D1BrowserTestRepo(env.DB);
  const runs = overrides.runs ?? new D1RunRepo(env.DB);
  const attempts = overrides.attempts ?? new D1AttemptRepo(env.DB);
  const runnerWorkers =
    overrides.runnerWorkers ?? new D1RunnerWorkerRepo(env.DB);
  const steps = overrides.steps ?? new D1StepRepo(env.DB);
  const artifacts = overrides.artifacts ?? new D1ArtifactRepo(env.DB);
  const artifactStorage =
    overrides.artifactStorage ?? new ArtifactStorage(env.ARTIFACTS);
  const incidents = overrides.incidents ?? new D1IncidentRepo(env.DB);
  const incidentEvents =
    overrides.incidentEvents ?? new D1IncidentEventRepo(env.DB);
  const monitors = overrides.monitors ?? new D1MonitorRepo(env.DB);
  const checks = overrides.checks ?? new D1CheckRepo(env.DB);
  const overview = overrides.overview ?? new D1OverviewRepo(env.DB);
  const apiKeys = overrides.apiKeys ?? new D1ApiKeyRepo(env.DB);
  const alerts = overrides.alerts ?? new D1AlertRepo(env.DB);
  const charger = new ChargePaidDelivery(
    alerts,
    workspaces,
    users,
    emailSender,
    config.appUrl,
    clock,
    overrides.ids ?? realIds,
  );
  const defaultEmailChannel = new EnsureDefaultEmailChannel(
    channels,
    alerts,
    config.encryptionKeys,
    clock,
    overrides.ids ?? realIds,
  );
  const defaultPushChannel = new EnsureDefaultPushChannel(
    channels,
    alerts,
    browserTests,
    monitors,
    config.encryptionKeys,
    clock,
    overrides.ids ?? realIds,
  );
  const durableWorkflows = new D1DurableWorkflowRepo(env.DB);
  const runQueue = overrides.runQueue ?? resolveAttemptDispatch(env);
  const outboxPublisher = new PublishQueueOutbox(
    durableWorkflows,
    {
      RUN: runQueue,
      CHECK: env.CHECK_QUEUE as Pick<Queue<CheckMessage>, "send">,
      NOTIFY: env.NOTIFY_QUEUE as Pick<Queue<NotifyMessage>, "send">,
    },
    clock,
  );
  const uptimeCheckExecutor =
    overrides.uptimeCheckExecutor ??
    ((
      monitorConfig: MonitorConfig,
      workspaceId: string,
      execution?: { idempotencyKey?: string },
    ) =>
      executeCheck(
        {
          fetchFn: (input, init) => globalThis.fetch(input, init),
          clock,
          resolveSecrets,
        },
        monitorConfig,
        workspaceId,
        execution,
      ));
  const incidentCloserOnTestDelete =
    overrides.incidentCloserOnTestDelete ??
    new CloseIncidentOnTestDelete(
      incidents,
      incidentEvents,
      overrides.ids ?? realIds,
    );
  const stripeClient =
    overrides.stripeClient ??
    (config.stripe === null
      ? null
      : new HttpStripeClient(config.stripe, config.appUrl));
  const billingClient =
    overrides.billingClient ??
    overrides.paddleClient ??
    stripeClient ??
    (config.paddle === null
      ? new UnavailablePaddleClient()
      : new HttpPaddleClient(config.paddle));
  const providerConfig = config.stripe ?? config.paddle;
  const overageReporter =
    overrides.overageReporter ??
    (providerConfig === null
      ? null
      : new ReportOverageForPeriod(
          usageEvents,
          overageReports,
          billingClient,
          providerConfig.overagePriceId,
          clock,
          overrides.ids ?? realIds,
        ));
  const billingCanceller =
    overrides.billingCanceller ??
    (providerConfig === null
      ? new NoopBillingCanceller()
      : new PaddleBillingCanceller(subscriptions, billingClient, clock));
  const workspaceDeletion =
    overrides.workspaceDeletion ??
    new WorkspaceDeletionSaga(
      new D1WorkspaceDeletionRepo(env.DB),
      billingCanceller,
      artifactStorage,
      clock,
    );
  const audit = new WriteAudit({
    audits,
    activity: track,
    clock,
    ids: overrides.ids ?? realIds,
  });
  const externalRunner =
    overrides.externalRunner ??
    new ExternalRunner({
      lifecycle: new AttemptLifecycle({
        runs,
        attempts,
        steps,
        artifacts,
        tests: browserTests,
        workspaces,
        storage: artifactStorage,
        recordUsage: new RecordRunUsage(
          usageEvents,
          clock,
          overrides.ids ?? realIds,
        ),
        reverseUsage: new ReverseRunUsage(usageEvents, clock),
        durable: durableWorkflows,
        outboxPublisher,
        track,
        clock,
        ids: overrides.ids ?? realIds,
        runFinalizedHandler: new HandleRunFinalized({
          incidents,
          events: incidentEvents,
          runs,
          attempts,
          dispatchNotifications: new DispatchNotifications(
            channels,
            durableWorkflows,
            outboxPublisher,
            clock,
            overrides.ids ?? realIds,
          ),
          channels,
          workspaces,
          reports: new GenerateReport({
            attempts,
            steps,
            artifacts,
            workspaces,
            resolveSecrets,
            storage: artifactStorage,
            clock,
            ids: overrides.ids ?? realIds,
          }),
          appUrl: config.appUrl,
          track,
          clock,
          ids: overrides.ids ?? realIds,
        }),
      }),
      runs,
      attempts,
      steps,
      artifacts,
      storage: artifactStorage,
      resolveSecrets,
      clock,
      ids: overrides.ids ?? realIds,
      authorizationSigningSecret: config.runnerCapabilitySecret,
    });

  app.use("*", requestId);
  app.use("*", securityHeaders);
  // Cloudflare accepts request bodies far larger than an isolate can safely
  // materialize. Count every stream before any JSON/raw-body parser runs;
  // Content-Length is only an early-rejection hint, never the enforcement.
  // Route selection is deterministic and fail-closed: ordinary JSON and the
  // unauthenticated billing webhooks receive 256 KiB, imports receive their
  // domain limit, and only a runner step carrying one bounded JPEG receives
  // the absolute 3.2 MB allowance.
  app.use(
    "/api/*",
    strictBodyLimit({
      maxSize: (context) => {
        const path = context.req.path;
        if (path === "/api/webhooks/paddle") {
          return MAX_PADDLE_WEBHOOK_BODY_BYTES;
        }
        if (path === "/api/webhooks/stripe") {
          return MAX_STRIPE_WEBHOOK_BODY_BYTES;
        }
        if (
          /^\/api\/workspaces\/[^/]+\/browser-tests\/import$/u.test(path)
        ) {
          return MAX_BROWSER_TEST_IMPORT_BODY_BYTES;
        }
        if (/^\/api\/runner\/attempts\/[^/]+\/steps$/u.test(path)) {
          return MAX_API_REQUEST_BODY_BYTES;
        }
        return MAX_STANDARD_API_REQUEST_BODY_BYTES;
      },
      onError: (context) =>
        context.json(
          { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } },
          413,
        ),
    }),
  );
  // The SPA calls the API cross-origin (api.zenguy.com from app.zenguy.com);
  // only the configured application origin may send credentialed requests.
  // /api/v1 is the key-authenticated public read API: no cookies are ever
  // involved there, so any origin may call it (the API key is the credential).
  const spaCors = cors({
    origin: (origin) => (origin === config.appUrl ? origin : null),
    credentials: true,
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Disposition"],
    maxAge: 86_400,
  });
  const publicApiCors = cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "X-Api-Key"],
    allowMethods: ["GET", "OPTIONS"],
    maxAge: 86_400,
  });
  app.use("*", (context, next) =>
    context.req.path.startsWith("/api/v1/")
      ? publicApiCors(context, next)
      : spaCors(context, next),
  );
  app.onError(errorHandler);

  app.get("/api/health", (context) => context.json({ data: { ok: true } }));
  app.route("/api/app", appVersionRoutes(config));
  app.route(
    "/api/me",
    pushDeviceRoutes({
      users,
      workspaces,
      pushDevices,
      defaultPushChannel,
      track,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/me",
    activityRoutes({
      users,
      members,
      activityEvents,
      rateLimiter,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/runner",
    runnerRoutes({
      environment: config.environment,
      primaryToken: config.runnerApiToken,
      fallbackToken: config.runnerFallbackApiToken,
      cfToken: config.runnerCfApiToken,
      capabilitySecret: config.runnerCapabilitySecret,
      runner: externalRunner,
      workers: runnerWorkers,
      clock,
    }),
  );
  app.route(
    "/api",
    artifactRoutes({ artifacts, storage: artifactStorage, clock, config }),
  );
  app.route(
    "/api/workspaces",
    runEventRoutes({
      runs,
      attempts,
      users,
      resolveSecrets,
      clock,
      config,
    }),
  );
  app.route(
    "/api/auth",
    authRoutes({
      users,
      emailTokens,
      refreshTokens,
      sessionSecurity,
      workspaces,
      audit,
      track,
      emailSender,
      rateLimiter,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  const invitationDependencies = {
    users,
    workspaces,
    members,
    invitations,
    emailSender,
    audit,
    rateLimiter,
    clock,
    ids: overrides.ids ?? realIds,
    config,
  };
  app.route(
    "/api/workspaces",
    workspaceInvitationRoutes(invitationDependencies),
  );
  app.route(
    "/api/workspaces",
    memberRoutes({
      users,
      workspaces,
      members,
      invitations,
      apiKeys,
      audit,
      clock,
      config,
    }),
  );
  app.route(
    "/api/invitations",
    publicInvitationRoutes(invitationDependencies),
  );
  app.route(
    "/api/workspaces",
    workspaceRoutes({
      users,
      workspaces,
      members,
      invitations,
      workspaceDeletion,
      subscriptions,
      defaultEmailChannel,
      defaultPushChannel,
      audit,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/workspaces",
    alertRoutes({
      users,
      workspaces,
      members,
      channels,
      alerts,
      checkoutIntents,
      ...(stripeClient === null ? {} : { stripeCheckout: stripeClient }),
      audit,
      track,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api",
    billingRoutes({
      users,
      workspaces,
      members,
      subscriptions,
      usageEvents,
      checkoutIntents,
      paddle: billingClient,
      ...(stripeClient === null ? {} : { stripeCheckout: stripeClient }),
      track,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/subscription-grants",
    subscriptionGrantRoutes({
      users,
      workspaces,
      members,
      subscriptions,
      grants: subscriptionGrants,
      audit,
      rateLimiter,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/workspaces",
    secretRoutes({
      users,
      workspaces,
      members,
      subscriptions,
      secrets,
      encryptionRotation,
      rateLimiter,
      audit,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/workspaces",
    channelRoutes({
      users,
      workspaces,
      members,
      subscriptions,
      alerts,
      charger,
      pushDevices,
      channels,
      deliveries,
      sender: channelSender,
      rateLimiter,
      audit,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/workspaces",
    incidentRoutes({
      users,
      workspaces,
      members,
      incidents,
      incidentEvents,
      deliveries,
      clock,
      config,
    }),
  );
  app.route(
    "/api/workspaces",
    auditRoutes({ users, workspaces, members, audits, config }),
  );
  app.route(
    "/api/workspaces",
    apiKeyRoutes({
      users,
      workspaces,
      members,
      subscriptions,
      apiKeys,
      audit,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/v1",
    publicApiRoutes({
      apiKeys,
      workspaces,
      users,
      monitors,
      incidents,
      tests: browserTests,
      runs,
      attempts,
      rateLimiter,
      resolveSecrets,
      track,
      clock,
      config,
    }),
  );
  app.route(
    "/api/workspaces",
    overviewRoutes({
      users,
      workspaces,
      members,
      subscriptions,
      usageEvents,
      overview,
      clock,
      config,
    }),
  );
  app.route(
    "/api/workspaces",
    uptimeRoutes({
      users,
      workspaces,
      members,
      subscriptions,
      channels,
      monitors,
      checks,
      incidents,
      incidentEvents,
      rateLimiter,
      audit,
      track,
      executeCheck: uptimeCheckExecutor,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/workspaces",
    browserTestRoutes({
      users,
      workspaces,
      members,
      subscriptions,
      channels,
      tests: browserTests,
      runs,
      attempts,
      steps,
      artifacts,
      artifactStorage,
      incidents: incidentCloserOnTestDelete,
      durableWorkflows,
      outboxPublisher,
      rateLimiter,
      audit,
      track,
      resolveSecrets,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  if (config.paddle !== null && overageReporter !== null) {
    app.route(
      "/api/webhooks",
      webhookRoutes({
        webhookSecret: config.paddle.webhookSecret,
        kv: env.KV,
        subscriptions,
        checkoutIntents,
        workspaces,
        pendingOveragePeriods,
        overageReporter,
        audit,
        clock,
        ids: overrides.ids ?? realIds,
        alerts,
        alertCreditProductId: config.paddle.alertCreditProductId,
        alertCreditPriceId: config.paddle.alertCreditPriceId,
        subscriptionProductId: config.paddle.productId,
        subscriptionPriceId: config.paddle.priceId,
      }),
    );
  }
  if (config.stripe !== null && overageReporter !== null) {
    app.route(
      "/api/webhooks",
      stripeWebhookRoutes({
        webhookSecret: config.stripe.webhookSecret,
        kv: env.KV,
        subscriptions,
        checkoutIntents,
        workspaces,
        pendingOveragePeriods,
        overageReporter,
        audit,
        clock,
        ids: overrides.ids ?? realIds,
        alerts,
        alertCreditProductId: config.stripe.alertCreditProductId,
        alertCreditPriceId: config.stripe.alertCreditPriceId,
        subscriptionProductId: config.stripe.productId,
        subscriptionPriceId: config.stripe.priceId,
      }),
    );
  }

  app.notFound((context) => {
    if (context.req.path.startsWith("/api/")) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Route not found" } },
        404,
      );
    }
    return new Response("Not Found", { status: 404 });
  });

  return app;
}
