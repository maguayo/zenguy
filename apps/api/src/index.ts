import { buildApp } from "./app";
import { TrackEvent } from "./application/activity/track_event";
import { ChargePaidDelivery } from "./application/alerts/charge_paid_delivery";
import {
  BackfillDefaultEmailChannels,
  EnsureDefaultEmailChannel,
} from "./application/alerts/ensure_default_email_channel";
import { D1ActivityEventRepo } from "./infrastructure/db/activity_event_repo";
import { D1AlertRepo } from "./infrastructure/db/alert_repo";
import { D1AuditRepo } from "./infrastructure/db/audit_repo";
import { D1PushDeviceRepo } from "./infrastructure/db/push_device_repo";
import { D1UserRepo } from "./infrastructure/db/user_repo";
import {
  BackfillDefaultPushChannels,
  EnsureDefaultPushChannel,
} from "./application/push/ensure_default_push_channel";
import { CreateRun } from "./application/browser_tests/create_run";
import { RecordRunUsage } from "./application/billing/record_run_usage";
import { ReportOverageForPeriod } from "./application/billing/report_overage_for_period";
import { ReverseRunUsage } from "./application/billing/reverse_run_usage";
import { SweepOverages } from "./application/billing/sweep_overages";
import { ReconcilePaddleCredits } from "./application/billing/reconcile_paddle_credits";
import { WriteAudit } from "./application/audit/write_audit";
import { DispatchNotifications } from "./application/channels/dispatch_notifications";
import { PublishQueueOutbox } from "./application/durability/publish_outbox";
import { DurableWorkflowMaintenance } from "./application/durability/maintenance";
import { RedriveDeadLetter } from "./application/durability/redrive_dead_letter";
import {
  SendQueuedNotification,
  type NotificationQueueControl,
} from "./application/channels/send_queued_notification";
import { AttemptLifecycle } from "./application/execution/attempt_lifecycle";
import { HandleRunFinalized } from "./application/incidents/handle_run_finalized";
import { HourlyMaintenance } from "./application/maintenance/hourly";
import { WorkspaceDeletionSaga } from "./application/workspaces/workspace_deletion_saga";
import { PurgeExpired } from "./application/maintenance/purge_expired";
import { SweepDueMonitors } from "./application/maintenance/sweep_due_monitors";
import { SweepDueTests } from "./application/maintenance/sweep_due_tests";
import { WriteIncidentNotificationEvent } from "./application/incidents/write_notification_event";
import { GenerateReport } from "./application/reports/generate_report";
import { ResolveSecrets } from "./application/secrets/resolve_secrets";
import { executeCheck } from "./application/uptime/execute_check";
import { HandleCheckMessage } from "./application/uptime/handle_check_message";
import {
  checkMessageSchema,
  notifyMessageSchema,
  type AttemptMessage,
  type CheckMessage,
  type NotifyMessage,
} from "./domain/queues";
import { D1ArtifactRepo } from "./infrastructure/db/artifact_repo";
import { D1AttemptRepo } from "./infrastructure/db/attempt_repo";
import { D1BrowserTestRepo } from "./infrastructure/db/browser_test_repo";
import { D1ChannelRepo } from "./infrastructure/db/channel_repo";
import { D1CheckRepo } from "./infrastructure/db/check_repo";
import { D1CleanupRepo } from "./infrastructure/db/cleanup_repo";
import { D1DeliveryRepo } from "./infrastructure/db/delivery_repo";
import { D1DurableWorkflowRepo } from "./infrastructure/db/durable_workflow_repo";
import { D1IncidentEventRepo } from "./infrastructure/db/incident_event_repo";
import { D1IncidentRepo } from "./infrastructure/db/incident_repo";
import { D1MonitorRepo } from "./infrastructure/db/monitor_repo";
import { D1OverageReportRepo } from "./infrastructure/db/overage_report_repo";
import {
  D1PendingOveragePeriodRepo,
} from "./infrastructure/db/pending_overage_period_repo";
import { D1RunRepo } from "./infrastructure/db/run_repo";
import { D1SecretRepo } from "./infrastructure/db/secret_repo";
import { D1StepRepo } from "./infrastructure/db/step_repo";
import { D1SubscriptionRepo } from "./infrastructure/db/subscription_repo";
import { D1UsageEventRepo } from "./infrastructure/db/usage_event_repo";
import { D1WorkspaceRepo } from "./infrastructure/db/workspace_repo";
import { D1WorkspaceDeletionRepo } from "./infrastructure/db/workspace_deletion_repo";
import { buildEmailSender } from "./infrastructure/email";
import { buildChannelSender } from "./infrastructure/notify";
import { HttpPaddleClient } from "./infrastructure/paddle/client";
import { PaddleBillingCanceller } from "./infrastructure/paddle/billing_canceller";
import { NoopBillingCanceller } from "./infrastructure/billing/noop";
import { ArtifactStorage } from "./infrastructure/storage/artifacts";
import { systemClock } from "./shared/clock";
import { loadConfig, type Bindings } from "./shared/config";
import { realIds } from "./shared/ids";
import { logEvent, platformAlert } from "./shared/log";
import {
  enforceStagingAccess,
  type StagingAccessVerificationOptions,
} from "./http/middleware/staging_access";
import {
  enforceProductionRunnerAccess,
  type RunnerAccessVerificationOptions,
} from "./http/middleware/runner_access";

function buildCharger(
  env: Bindings,
  config: ReturnType<typeof loadConfig>,
  emailSender: ReturnType<typeof buildEmailSender>,
): ChargePaidDelivery {
  return new ChargePaidDelivery(
    new D1AlertRepo(env.DB),
    new D1WorkspaceRepo(env.DB),
    new D1UserRepo(env.DB),
    emailSender,
    config.appUrl,
    systemClock,
    realIds,
  );
}

function buildTracker(env: Bindings): TrackEvent {
  return new TrackEvent({
    activity: new D1ActivityEventRepo(env.DB),
    clock: systemClock,
    ids: realIds,
  });
}

type NotifyConsumer = Pick<SendQueuedNotification, "execute">;
export interface CheckQueueConsumer {
  execute(message: CheckMessage, context: ExecutionContext): Promise<void>;
}

export interface QueueConsumers {
  checks: CheckQueueConsumer;
  notifications: NotifyConsumer;
  deadLetters?: Pick<RedriveDeadLetter, "execute">;
}

export interface ScheduledJob {
  execute(): Promise<unknown>;
}

export interface ScheduledJobs {
  tests: ScheduledJob;
  monitors: ScheduledJob;
  durability?: ScheduledJob;
  deletions?: ScheduledJob;
  retention: ScheduledJob;
  hourly: ScheduledJob;
}

type QueueKind = "runs" | "checks" | "notify";

export function classifyQueue(queueName: string): QueueKind | undefined {
  switch (queueName) {
    case "zenguy-runs":
    case "zenguy-staging-runs":
      return "runs";
    case "zenguy-checks":
    case "zenguy-staging-checks":
      return "checks";
    case "zenguy-notify":
    case "zenguy-staging-notify":
      return "notify";
    default:
      return undefined;
  }
}

function queueRetryDelay(attempts: number): number {
  return Math.min(300, 30 * 2 ** Math.max(0, attempts - 1));
}

export async function processNotifyBatch(
  batch: MessageBatch<unknown>,
  consumer: NotifyConsumer,
): Promise<void> {
  for (const queueMessage of batch.messages) {
    const parsed = notifyMessageSchema.safeParse(queueMessage.body);
    if (!parsed.success) {
      queueMessage.ack();
      platformAlert("bad_queue_message", {
        queue: batch.queue,
        messageId: queueMessage.id,
      });
      continue;
    }
    try {
      await consumer.execute(
        parsed.data,
        queueMessage as NotificationQueueControl,
      );
    } catch {
      platformAlert("queue_message_failed", {
        queue: batch.queue,
        messageId: queueMessage.id,
      });
      queueMessage.retry({
        delaySeconds: queueRetryDelay(queueMessage.attempts),
      });
    }
  }
}

function badQueueMessage(batch: MessageBatch<unknown>, message: Message): void {
  message.ack();
  platformAlert("bad_queue_message", {
    queue: batch.queue,
    messageId: message.id,
  });
}

function failedQueueMessage(
  batch: MessageBatch<unknown>,
  message: Message,
): void {
  platformAlert("queue_message_failed", {
    queue: batch.queue,
    messageId: message.id,
  });
  message.retry();
}

function deferExternalRunBatch(batch: MessageBatch<unknown>): void {
  platformAlert("run_push_consumer_disabled", { queue: batch.queue });
  for (const message of batch.messages) {
    message.retry({ delaySeconds: 60 });
  }
}

export async function processCheckBatch(
  batch: MessageBatch<unknown>,
  consumer: CheckQueueConsumer,
  context: ExecutionContext,
): Promise<void> {
  for (const queueMessage of batch.messages) {
    const parsed = checkMessageSchema.safeParse(queueMessage.body);
    if (!parsed.success) {
      badQueueMessage(batch, queueMessage);
      continue;
    }
    try {
      await consumer.execute(parsed.data, context);
      queueMessage.ack();
    } catch {
      failedQueueMessage(batch, queueMessage);
    }
  }
}

export async function processDeadLetterBatch(
  batch: MessageBatch<unknown>,
  consumer?: Pick<RedriveDeadLetter, "execute">,
): Promise<void> {
  for (const queueMessage of batch.messages) {
    platformAlert("dlq_message", {
      queue: batch.queue,
      messageId: queueMessage.id,
    });
    if (consumer === undefined) {
      platformAlert("dlq_consumer_unavailable", {
        queue: batch.queue,
        messageId: queueMessage.id,
      });
      queueMessage.retry({
        delaySeconds: queueRetryDelay(queueMessage.attempts),
      });
      continue;
    }
    try {
      await consumer.execute(batch.queue, queueMessage);
    } catch {
      platformAlert("dlq_redrive_failed", {
        queue: batch.queue,
        messageId: queueMessage.id,
      });
      queueMessage.retry({
        delaySeconds: queueRetryDelay(queueMessage.attempts),
      });
    }
  }
}

export async function processQueueBatch(
  batch: MessageBatch<unknown>,
  consumers: QueueConsumers,
  context: ExecutionContext,
): Promise<void> {
  if (batch.queue.endsWith("-dlq")) {
    await processDeadLetterBatch(batch, consumers.deadLetters);
    return;
  }
  switch (classifyQueue(batch.queue)) {
    case "runs":
      deferExternalRunBatch(batch);
      return;
    case "checks":
      await processCheckBatch(batch, consumers.checks, context);
      return;
    case "notify":
      await processNotifyBatch(batch, consumers.notifications);
      return;
    default:
      platformAlert("unsupported_queue", { queue: batch.queue });
      for (const message of batch.messages) message.retry();
  }
}

export async function processScheduledCron(
  cron: string,
  jobs: ScheduledJobs,
): Promise<void> {
  try {
    switch (cron) {
      case "*/5 * * * *":
        await Promise.all([
          jobs.tests.execute(),
          jobs.monitors.execute(),
          jobs.durability?.execute() ?? Promise.resolve(),
          jobs.deletions?.execute() ?? Promise.resolve(),
        ]);
        return;
      case "0 3 * * *":
        await jobs.retention.execute();
        return;
      case "30 * * * *":
        await jobs.hourly.execute();
        return;
      default:
        platformAlert("unsupported_cron", { cron });
    }
  } catch {
    platformAlert("scheduled_job_failed", { cron });
  }
}

function notifyConsumer(env: Bindings): SendQueuedNotification {
  const config = loadConfig(env);
  const emailSender = buildEmailSender(config, env.EMAIL);
  const incidents = new D1IncidentRepo(env.DB);
  const incidentEvents = new D1IncidentEventRepo(env.DB);
  return new SendQueuedNotification(
    new D1DeliveryRepo(env.DB),
    new D1ChannelRepo(env.DB),
    buildChannelSender(config, emailSender, fetch, {
      devices: new D1PushDeviceRepo(env.DB),
      appUrl: config.appUrl,
      accessToken: config.expoPushAccessToken,
      clock: systemClock,
    }),
    new WriteIncidentNotificationEvent(
      incidents,
      incidentEvents,
      systemClock,
      realIds,
    ),
    config.encryptionKeys,
    systemClock,
    buildCharger(env, config, emailSender),
    new D1WorkspaceDeletionRepo(env.DB),
    buildTracker(env),
  );
}

export function buildAttemptLifecycle(env: Bindings): AttemptLifecycle {
  const config = loadConfig(env);
  const runs = new D1RunRepo(env.DB);
  const attempts = new D1AttemptRepo(env.DB);
  const steps = new D1StepRepo(env.DB);
  const artifacts = new D1ArtifactRepo(env.DB);
  const browserTests = new D1BrowserTestRepo(env.DB);
  const workspaces = new D1WorkspaceRepo(env.DB);
  const usageEvents = new D1UsageEventRepo(env.DB);
  const channels = new D1ChannelRepo(env.DB);
  const deliveries = new D1DeliveryRepo(env.DB);
  const incidents = new D1IncidentRepo(env.DB);
  const incidentEvents = new D1IncidentEventRepo(env.DB);
  const storage = new ArtifactStorage(env.ARTIFACTS);
  const durable = new D1DurableWorkflowRepo(env.DB);
  const outboxPublisher = new PublishQueueOutbox(
    durable,
    {
      RUN: env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">,
      CHECK: env.CHECK_QUEUE as Pick<Queue<CheckMessage>, "send">,
      NOTIFY: env.NOTIFY_QUEUE as Pick<Queue<NotifyMessage>, "send">,
    },
    systemClock,
  );
  const secretResolver = new ResolveSecrets(
    new D1SecretRepo(env.DB),
    config.encryptionKeys,
  );
  const dispatchNotifications = new DispatchNotifications(
    channels,
    durable,
    outboxPublisher,
    systemClock,
    realIds,
  );
  const track = buildTracker(env);
  return new AttemptLifecycle({
    runs,
    attempts,
    steps,
    artifacts,
    tests: browserTests,
    workspaces,
    storage,
    recordUsage: new RecordRunUsage(usageEvents, systemClock, realIds),
    reverseUsage: new ReverseRunUsage(usageEvents, systemClock),
    durable,
    outboxPublisher,
    track,
    clock: systemClock,
    ids: realIds,
    runFinalizedHandler: new HandleRunFinalized({
      incidents,
      events: incidentEvents,
      runs,
      attempts,
      dispatchNotifications,
      channels,
      workspaces,
      reports: new GenerateReport({
        attempts,
        steps,
        artifacts,
        workspaces,
        resolveSecrets: secretResolver,
        storage,
        clock: systemClock,
        ids: realIds,
      }),
      appUrl: config.appUrl,
      track,
      clock: systemClock,
      ids: realIds,
    }),
  });
}

export function buildCheckConsumer(env: Bindings): HandleCheckMessage {
  const config = loadConfig(env);
  const monitors = new D1MonitorRepo(env.DB);
  const durableWorkflows = new D1DurableWorkflowRepo(env.DB);
  const outboxPublisher = new PublishQueueOutbox(
    durableWorkflows,
    {
      RUN: env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">,
      CHECK: env.CHECK_QUEUE as Pick<Queue<CheckMessage>, "send">,
      NOTIFY: env.NOTIFY_QUEUE as Pick<Queue<NotifyMessage>, "send">,
    },
    systemClock,
  );
  const checks = new D1CheckRepo(env.DB);
  const incidents = new D1IncidentRepo(env.DB);
  const events = new D1IncidentEventRepo(env.DB);
  const channels = new D1ChannelRepo(env.DB);
  const deliveries = new D1DeliveryRepo(env.DB);
  const workspaces = new D1WorkspaceRepo(env.DB);
  const resolveSecrets = new ResolveSecrets(
    new D1SecretRepo(env.DB),
    config.encryptionKeys,
  );
  const dispatchNotifications = new DispatchNotifications(
    channels,
    durableWorkflows,
    outboxPublisher,
    systemClock,
    realIds,
  );
  return new HandleCheckMessage({
    monitors,
    checks,
    incidents,
    events,
    channels,
    workspaces,
    dispatchNotifications,
    durable: durableWorkflows,
    outboxPublisher,
    executeCheck: (monitorConfig, workspaceId, execution) =>
      executeCheck(
        {
          fetchFn: (input, init) => globalThis.fetch(input, init),
          clock: systemClock,
          resolveSecrets,
        },
        monitorConfig,
        workspaceId,
        execution,
      ),
    encryptionKeys: config.encryptionKeys,
    appUrl: config.appUrl,
    track: buildTracker(env),
    clock: systemClock,
    ids: realIds,
  });
}

export function buildSchedulerJobs(
  env: Bindings,
): Pick<ScheduledJobs, "tests" | "monitors"> {
  const config = loadConfig(env);
  const browserTests = new D1BrowserTestRepo(env.DB);
  const runs = new D1RunRepo(env.DB);
  const workspaces = new D1WorkspaceRepo(env.DB);
  const subscriptions = new D1SubscriptionRepo(env.DB);
  const monitors = new D1MonitorRepo(env.DB);
  const durableWorkflows = new D1DurableWorkflowRepo(env.DB);
  const outboxPublisher = new PublishQueueOutbox(
    durableWorkflows,
    {
      RUN: env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">,
      CHECK: env.CHECK_QUEUE as Pick<Queue<CheckMessage>, "send">,
      NOTIFY: env.NOTIFY_QUEUE as Pick<Queue<NotifyMessage>, "send">,
    },
    systemClock,
  );
  return {
    tests: new SweepDueTests(
      browserTests,
      runs,
      workspaces,
      subscriptions,
      new CreateRun(
        browserTests,
        runs,
        workspaces,
        subscriptions,
        durableWorkflows,
        outboxPublisher,
        config,
        systemClock,
        realIds,
      ),
      systemClock,
    ),
    monitors: new SweepDueMonitors(
      monitors,
      workspaces,
      subscriptions,
      durableWorkflows,
      outboxPublisher,
      systemClock,
      realIds,
    ),
  };
}

export function buildRetentionJob(env: Bindings): PurgeExpired {
  return new PurgeExpired(
    new D1CleanupRepo(env.DB),
    new D1ArtifactRepo(env.DB),
    new D1CheckRepo(env.DB),
    new ArtifactStorage(env.ARTIFACTS),
    systemClock,
    logEvent,
    new D1ActivityEventRepo(env.DB),
  );
}

export function buildDurabilityJob(env: Bindings): DurableWorkflowMaintenance {
  const durable = new D1DurableWorkflowRepo(env.DB);
  const publisher = new PublishQueueOutbox(
    durable,
    {
      RUN: env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">,
      CHECK: env.CHECK_QUEUE as Pick<Queue<CheckMessage>, "send">,
      NOTIFY: env.NOTIFY_QUEUE as Pick<Queue<NotifyMessage>, "send">,
    },
    systemClock,
  );
  return new DurableWorkflowMaintenance(
    buildAttemptLifecycle(env),
    buildCheckConsumer(env),
    publisher,
    durable,
    durable,
    systemClock,
  );
}

export function buildWorkspaceDeletionJob(
  env: Bindings,
): WorkspaceDeletionSaga {
  const config = loadConfig(env);
  const subscriptions = new D1SubscriptionRepo(env.DB);
  const billing =
    config.paddle === null
      ? new NoopBillingCanceller()
      : new PaddleBillingCanceller(
          subscriptions,
          new HttpPaddleClient(config.paddle),
          systemClock,
        );
  return new WorkspaceDeletionSaga(
    new D1WorkspaceDeletionRepo(env.DB),
    billing,
    new ArtifactStorage(env.ARTIFACTS),
    systemClock,
  );
}

export function buildDeadLetterConsumer(env: Bindings): RedriveDeadLetter {
  const durable = new D1DurableWorkflowRepo(env.DB);
  const publisher = new PublishQueueOutbox(
    durable,
    {
      RUN: env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">,
      CHECK: env.CHECK_QUEUE as Pick<Queue<CheckMessage>, "send">,
      NOTIFY: env.NOTIFY_QUEUE as Pick<Queue<NotifyMessage>, "send">,
    },
    systemClock,
  );
  return new RedriveDeadLetter(durable, publisher, systemClock, realIds);
}

function buildDefaultChannelBackfill(
  env: Bindings,
  config: ReturnType<typeof loadConfig>,
  alerts: D1AlertRepo,
): { execute(): Promise<unknown> } {
  const channels = new D1ChannelRepo(env.DB);
  const email = new BackfillDefaultEmailChannels(
    alerts,
    new EnsureDefaultEmailChannel(
      channels,
      alerts,
      config.encryptionKeys,
      systemClock,
      realIds,
    ),
  );
  const push = new BackfillDefaultPushChannels(
    alerts,
    new EnsureDefaultPushChannel(
      channels,
      alerts,
      new D1BrowserTestRepo(env.DB),
      new D1MonitorRepo(env.DB),
      config.encryptionKeys,
      systemClock,
      realIds,
    ),
  );
  return {
    async execute() {
      await email.execute();
      await push.execute();
    },
  };
}

export function buildHourlyJob(env: Bindings): HourlyMaintenance {
  const config = loadConfig(env);
  const subscriptions = new D1SubscriptionRepo(env.DB);
  const reports = new D1OverageReportRepo(env.DB);
  const pendingPeriods = new D1PendingOveragePeriodRepo(env.DB);
  const usageEvents = new D1UsageEventRepo(env.DB);
  const overages =
    config.paddle === null
      ? { execute: async () => undefined }
      : new SweepOverages(
          subscriptions,
          reports,
          pendingPeriods,
          new ReportOverageForPeriod(
            usageEvents,
            reports,
            new HttpPaddleClient(config.paddle),
            config.paddle.overagePriceId,
            systemClock,
            realIds,
          ),
          systemClock,
        );
  const alerts = new D1AlertRepo(env.DB);
  const paddleCredits =
    config.paddle === null
      ? null
      : new ReconcilePaddleCredits(
          alerts,
          new HttpPaddleClient(config.paddle),
          new WriteAudit({
            audits: new D1AuditRepo(env.DB),
            activity: buildTracker(env),
            clock: systemClock,
            ids: realIds,
          }),
          systemClock,
          realIds,
        );
  return new HourlyMaintenance(
    overages,
    new D1AttemptRepo(env.DB),
    new D1RunRepo(env.DB),
    buildAttemptLifecycle(env),
    new D1MonitorRepo(env.DB),
    systemClock,
    platformAlert,
    buildDefaultChannelBackfill(env, config, alerts),
    paddleCredits,
  );
}

export async function scheduled(
  controller: ScheduledController,
  env: Bindings,
  _context: ExecutionContext,
): Promise<void> {
  await processScheduledCron(controller.cron, {
    ...buildSchedulerJobs(env),
    durability: buildDurabilityJob(env),
    deletions: buildWorkspaceDeletionJob(env),
    retention: buildRetentionJob(env),
    hourly: buildHourlyJob(env),
  });
}

export async function queue(
  batch: MessageBatch<unknown>,
  env: Bindings,
  context: ExecutionContext,
): Promise<void> {
  if (batch.queue.endsWith("-dlq")) {
    await processDeadLetterBatch(batch, buildDeadLetterConsumer(env));
    return;
  }
  switch (classifyQueue(batch.queue)) {
    case "runs":
      deferExternalRunBatch(batch);
      return;
    case "checks":
      await processCheckBatch(batch, buildCheckConsumer(env), context);
      return;
    case "notify":
      await processNotifyBatch(batch, notifyConsumer(env));
      return;
    default:
      platformAlert("unsupported_queue", { queue: batch.queue });
      for (const message of batch.messages) message.retry();
  }
}

export async function handleHttpRequest(
  request: Request,
  env: Bindings,
  context: ExecutionContext,
  accessVerification: StagingAccessVerificationOptions = {},
  runnerAccessVerification: RunnerAccessVerificationOptions = {},
): Promise<Response> {
  const accessDenial = await enforceStagingAccess(
    request,
    env,
    accessVerification,
  );
  if (accessDenial !== null) return accessDenial;
  const runnerAccessDenial = await enforceProductionRunnerAccess(
    request,
    env,
    runnerAccessVerification,
  );
  if (runnerAccessDenial !== null) return runnerAccessDenial;
  return buildApp(env).fetch(request, env, context);
}

export default {
  fetch(request, env, context) {
    return handleHttpRequest(request, env, context);
  },
  queue,
  scheduled,
} satisfies ExportedHandler<Bindings>;
