import { Hono } from "hono";
import type { EmailSender } from "./domain/email/sender";
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
import type { AttemptMessage } from "./domain/queues";
import type { IncidentCloserOnDelete } from "./application/browser_tests/incident_closer";
import { NoopIncidentCloserOnDelete } from "./application/browser_tests/incident_closer";
import type { SecretRepo } from "./domain/secrets/repo";
import type {
  OverageReportRepo,
  SubscriptionRepo,
  UsageEventRepo,
} from "./domain/billing/repo";
import type { PeriodOverageReporter } from "./application/billing/handle_paddle_webhook";
import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  UserRepo,
} from "./domain/users/repo";
import type {
  InvitationRepo,
  MemberRepo,
  WorkspaceRepo,
} from "./domain/workspaces/repo";
import type { AppEnv } from "./http/env";
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
import { WriteAudit } from "./application/audit/write_audit";
import { D1AuditRepo } from "./infrastructure/db/audit_repo";
import { D1EmailTokenRepo } from "./infrastructure/db/email_token_repo";
import { D1RefreshTokenRepo } from "./infrastructure/db/refresh_token_repo";
import { D1UserRepo } from "./infrastructure/db/user_repo";
import { D1MemberRepo } from "./infrastructure/db/member_repo";
import { D1WorkspaceRepo } from "./infrastructure/db/workspace_repo";
import { D1InvitationRepo } from "./infrastructure/db/invitation_repo";
import { D1SubscriptionRepo } from "./infrastructure/db/subscription_repo";
import { D1UsageEventRepo } from "./infrastructure/db/usage_event_repo";
import { D1OverageReportRepo } from "./infrastructure/db/overage_report_repo";
import { D1SecretRepo } from "./infrastructure/db/secret_repo";
import { D1ChannelRepo } from "./infrastructure/db/channel_repo";
import { D1DeliveryRepo } from "./infrastructure/db/delivery_repo";
import { D1BrowserTestRepo } from "./infrastructure/db/browser_test_repo";
import { D1RunRepo } from "./infrastructure/db/run_repo";
import { D1AttemptRepo } from "./infrastructure/db/attempt_repo";
import { D1StepRepo } from "./infrastructure/db/step_repo";
import { D1ArtifactRepo } from "./infrastructure/db/artifact_repo";
import { ArtifactStorage } from "./infrastructure/storage/artifacts";
import { PaddleBillingCanceller } from "./infrastructure/paddle/billing_canceller";
import {
  HttpPaddleClient,
  type PaddleClient,
} from "./infrastructure/paddle/client";
import { buildEmailSender } from "./infrastructure/email";
import { webhookRoutes } from "./http/routes/webhooks";
import { billingRoutes } from "./http/routes/billing";
import { secretRoutes } from "./http/routes/secrets";
import { channelRoutes } from "./http/routes/channels";
import { browserTestRoutes } from "./http/routes/browser_tests";
import { artifactRoutes } from "./http/routes/artifacts";
import { buildChannelSender } from "./infrastructure/notify";
import { ReportOverageForPeriod } from "./application/billing/report_overage_for_period";
import type { Clock } from "./shared/clock";
import { systemClock } from "./shared/clock";
import { loadConfig, type Bindings } from "./shared/config";
import type { IdGenerator } from "./shared/ids";
import { realIds } from "./shared/ids";
import { KvRateLimiter, type RateLimiter } from "./shared/ratelimit";

export interface AppOverrides {
  clock?: Clock;
  ids?: IdGenerator;
  users?: UserRepo;
  emailTokens?: EmailTokenRepo;
  refreshTokens?: RefreshTokenRepo;
  emailSender?: EmailSender;
  rateLimiter?: RateLimiter;
  workspaces?: WorkspaceRepo;
  members?: MemberRepo;
  audits?: AuditRepo;
  invitations?: InvitationRepo;
  subscriptions?: SubscriptionRepo;
  usageEvents?: UsageEventRepo;
  overageReports?: OverageReportRepo;
  secrets?: SecretRepo;
  channels?: ChannelRepo;
  deliveries?: DeliveryRepo;
  channelSender?: ChannelSender;
  browserTests?: BrowserTestRepo;
  runs?: RunRepo;
  attempts?: AttemptRepo;
  steps?: StepRepo;
  artifacts?: ArtifactRepo;
  artifactStorage?: Pick<ArtifactStorage, "put" | "get" | "delete">;
  incidentCloserOnTestDelete?: IncidentCloserOnDelete;
  runQueue?: Pick<Queue<AttemptMessage>, "send">;
  paddleClient?: PaddleClient;
  overageReporter?: PeriodOverageReporter;
  billingCanceller?: BillingCanceller;
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
  const emailSender = overrides.emailSender ?? buildEmailSender(config);
  const rateLimiter =
    overrides.rateLimiter ?? new KvRateLimiter(env.KV, clock);
  const workspaces = overrides.workspaces ?? new D1WorkspaceRepo(env.DB);
  const members = overrides.members ?? new D1MemberRepo(env.DB);
  const audits = overrides.audits ?? new D1AuditRepo(env.DB);
  const invitations =
    overrides.invitations ?? new D1InvitationRepo(env.DB);
  const subscriptions =
    overrides.subscriptions ?? new D1SubscriptionRepo(env.DB);
  const usageEvents = overrides.usageEvents ?? new D1UsageEventRepo(env.DB);
  const overageReports =
    overrides.overageReports ?? new D1OverageReportRepo(env.DB);
  const secrets = overrides.secrets ?? new D1SecretRepo(env.DB);
  const channels = overrides.channels ?? new D1ChannelRepo(env.DB);
  const deliveries = overrides.deliveries ?? new D1DeliveryRepo(env.DB);
  const channelSender =
    overrides.channelSender ?? buildChannelSender(config, emailSender);
  const browserTests =
    overrides.browserTests ?? new D1BrowserTestRepo(env.DB);
  const runs = overrides.runs ?? new D1RunRepo(env.DB);
  const attempts = overrides.attempts ?? new D1AttemptRepo(env.DB);
  const steps = overrides.steps ?? new D1StepRepo(env.DB);
  const artifacts = overrides.artifacts ?? new D1ArtifactRepo(env.DB);
  const artifactStorage =
    overrides.artifactStorage ?? new ArtifactStorage(env.ARTIFACTS);
  const incidentCloserOnTestDelete =
    overrides.incidentCloserOnTestDelete ?? new NoopIncidentCloserOnDelete();
  const paddleClient =
    overrides.paddleClient ?? new HttpPaddleClient(config.paddle);
  const overageReporter =
    overrides.overageReporter ??
    new ReportOverageForPeriod(
      subscriptions,
      usageEvents,
      overageReports,
      paddleClient,
      config.paddle.overagePriceId,
      clock,
      overrides.ids ?? realIds,
    );
  const billingCanceller =
    overrides.billingCanceller ??
    new PaddleBillingCanceller(subscriptions, paddleClient, clock);
  const audit = new WriteAudit({
    audits,
    clock,
    ids: overrides.ids ?? realIds,
  });

  app.use("*", requestId);
  app.use("*", securityHeaders);
  app.onError(errorHandler);

  app.get("/api/health", (context) => context.json({ data: { ok: true } }));
  app.route(
    "/api",
    artifactRoutes({ artifacts, storage: artifactStorage, clock, config }),
  );
  app.route(
    "/api/auth",
    authRoutes({
      users,
      emailTokens,
      refreshTokens,
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
    memberRoutes({ users, workspaces, members, audit, config }),
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
      billingCanceller,
      subscriptions,
      audit,
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
      paddle: paddleClient,
      clock,
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
      runQueue:
        overrides.runQueue ??
        (env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">),
      rateLimiter,
      audit,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/webhooks",
    webhookRoutes({
      webhookSecret: config.paddle.webhookSecret,
      kv: env.KV,
      subscriptions,
      overageReporter,
      audit,
      clock,
      ids: overrides.ids ?? realIds,
    }),
  );

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
