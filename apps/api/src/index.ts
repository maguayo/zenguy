import { buildApp } from "./app";
import { CreateRun } from "./application/browser_tests/create_run";
import { RecordRunUsage } from "./application/billing/record_run_usage";
import { ReportOverageForPeriod } from "./application/billing/report_overage_for_period";
import { ReverseRunUsage } from "./application/billing/reverse_run_usage";
import { SweepOverages } from "./application/billing/sweep_overages";
import { DispatchNotifications } from "./application/channels/dispatch_notifications";
import {
  SendQueuedNotification,
  type NotificationQueueControl,
} from "./application/channels/send_queued_notification";
import { AttemptLifecycle } from "./application/execution/attempt_lifecycle";
import { ExecuteAttempt } from "./application/execution/execute_attempt";
import { HandleRunFinalized } from "./application/incidents/handle_run_finalized";
import { HourlyMaintenance } from "./application/maintenance/hourly";
import { PurgeExpired } from "./application/maintenance/purge_expired";
import { SweepDueMonitors } from "./application/maintenance/sweep_due_monitors";
import { SweepDueTests } from "./application/maintenance/sweep_due_tests";
import { WriteIncidentNotificationEvent } from "./application/incidents/write_notification_event";
import { GenerateReport } from "./application/reports/generate_report";
import { ResolveSecrets } from "./application/secrets/resolve_secrets";
import { executeCheck } from "./application/uptime/execute_check";
import { HandleCheckMessage } from "./application/uptime/handle_check_message";
import {
  attemptMessageSchema,
  checkMessageSchema,
  notifyMessageSchema,
  type AttemptMessage,
  type CheckMessage,
} from "./domain/queues";
import { launchSession } from "./infrastructure/browser/session";
import { D1ArtifactRepo } from "./infrastructure/db/artifact_repo";
import { D1AttemptRepo } from "./infrastructure/db/attempt_repo";
import { D1BrowserTestRepo } from "./infrastructure/db/browser_test_repo";
import { D1ChannelRepo } from "./infrastructure/db/channel_repo";
import { D1CheckRepo } from "./infrastructure/db/check_repo";
import { D1CleanupRepo } from "./infrastructure/db/cleanup_repo";
import { D1DeliveryRepo } from "./infrastructure/db/delivery_repo";
import { D1IncidentEventRepo } from "./infrastructure/db/incident_event_repo";
import { D1IncidentRepo } from "./infrastructure/db/incident_repo";
import { D1MonitorRepo } from "./infrastructure/db/monitor_repo";
import { D1OverageReportRepo } from "./infrastructure/db/overage_report_repo";
import { D1RunRepo } from "./infrastructure/db/run_repo";
import { D1SecretRepo } from "./infrastructure/db/secret_repo";
import { D1StepRepo } from "./infrastructure/db/step_repo";
import { D1SubscriptionRepo } from "./infrastructure/db/subscription_repo";
import { D1UsageEventRepo } from "./infrastructure/db/usage_event_repo";
import { D1WorkspaceRepo } from "./infrastructure/db/workspace_repo";
import { buildEmailSender } from "./infrastructure/email";
import { OpenAiLlmClient } from "./infrastructure/llm/openai";
import { buildChannelSender } from "./infrastructure/notify";
import { HttpPaddleClient } from "./infrastructure/paddle/client";
import { ArtifactStorage } from "./infrastructure/storage/artifacts";
import { systemClock } from "./shared/clock";
import { loadConfig, type Bindings } from "./shared/config";
import { realIds } from "./shared/ids";
import { platformAlert } from "./shared/log";

type NotifyConsumer = Pick<SendQueuedNotification, "execute">;
export interface AttemptQueueConsumer {
  execute(message: AttemptMessage, context: ExecutionContext): Promise<void>;
}

export interface CheckQueueConsumer {
  execute(message: CheckMessage, context: ExecutionContext): Promise<void>;
}

export interface QueueConsumers {
  attempts: AttemptQueueConsumer;
  checks: CheckQueueConsumer;
  notifications: NotifyConsumer;
}

export interface ScheduledJob {
  execute(): Promise<unknown>;
}

export interface ScheduledJobs {
  tests: ScheduledJob;
  monitors: ScheduledJob;
  retention: ScheduledJob;
  hourly: ScheduledJob;
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

export async function processAttemptBatch(
  batch: MessageBatch<unknown>,
  consumer: AttemptQueueConsumer,
  context: ExecutionContext,
): Promise<void> {
  for (const queueMessage of batch.messages) {
    const parsed = attemptMessageSchema.safeParse(queueMessage.body);
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

function queueBodyPreview(body: unknown): string {
  try {
    return JSON.stringify(body).slice(0, 200);
  } catch {
    return "<unserializable>";
  }
}

export function processDeadLetterBatch(batch: MessageBatch<unknown>): void {
  for (const queueMessage of batch.messages) {
    platformAlert("dlq_message", {
      queue: batch.queue,
      body: queueBodyPreview(queueMessage.body),
    });
    queueMessage.ack();
  }
}

export async function processQueueBatch(
  batch: MessageBatch<unknown>,
  consumers: QueueConsumers,
  context: ExecutionContext,
): Promise<void> {
  if (batch.queue.endsWith("-dlq")) {
    processDeadLetterBatch(batch);
    return;
  }
  switch (batch.queue) {
    case "zenguy-runs":
      await processAttemptBatch(batch, consumers.attempts, context);
      return;
    case "zenguy-checks":
      await processCheckBatch(batch, consumers.checks, context);
      return;
    case "zenguy-notify":
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
        await Promise.all([jobs.tests.execute(), jobs.monitors.execute()]);
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
    buildChannelSender(config, emailSender),
    new WriteIncidentNotificationEvent(
      incidents,
      incidentEvents,
      systemClock,
      realIds,
    ),
    config.encryptionKey,
    systemClock,
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
  const secretResolver = new ResolveSecrets(
    new D1SecretRepo(env.DB),
    config.encryptionKey,
  );
  const dispatchNotifications = new DispatchNotifications(
    channels,
    deliveries,
    env.NOTIFY_QUEUE as Pick<Queue, "send">,
    systemClock,
    realIds,
  );
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
    queue: env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">,
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
      clock: systemClock,
      ids: realIds,
    }),
  });
}

export function buildAttemptConsumer(env: Bindings): ExecuteAttempt {
  const config = loadConfig(env);
  const runs = new D1RunRepo(env.DB);
  const attempts = new D1AttemptRepo(env.DB);
  const steps = new D1StepRepo(env.DB);
  const artifacts = new D1ArtifactRepo(env.DB);
  const storage = new ArtifactStorage(env.ARTIFACTS);
  const secretResolver = new ResolveSecrets(
    new D1SecretRepo(env.DB),
    config.encryptionKey,
  );
  return new ExecuteAttempt({
    lifecycle: buildAttemptLifecycle(env),
    runs,
    attempts,
    steps,
    artifacts,
    storage,
    resolveSecrets: secretResolver,
    launchSession: (device) => launchSession(env.BROWSER, device),
    llm: new OpenAiLlmClient(config),
    llmUseVision: config.llmUseVision,
    clock: systemClock,
    ids: realIds,
  });
}

export function buildCheckConsumer(env: Bindings): HandleCheckMessage {
  const config = loadConfig(env);
  const monitors = new D1MonitorRepo(env.DB);
  const checks = new D1CheckRepo(env.DB);
  const incidents = new D1IncidentRepo(env.DB);
  const events = new D1IncidentEventRepo(env.DB);
  const channels = new D1ChannelRepo(env.DB);
  const deliveries = new D1DeliveryRepo(env.DB);
  const workspaces = new D1WorkspaceRepo(env.DB);
  const resolveSecrets = new ResolveSecrets(
    new D1SecretRepo(env.DB),
    config.encryptionKey,
  );
  const dispatchNotifications = new DispatchNotifications(
    channels,
    deliveries,
    env.NOTIFY_QUEUE as Pick<Queue, "send">,
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
    checkQueue: env.CHECK_QUEUE as Pick<Queue<CheckMessage>, "send">,
    executeCheck: (monitorConfig, workspaceId) =>
      executeCheck(
        {
          fetchFn: (input, init) => globalThis.fetch(input, init),
          clock: systemClock,
          resolveSecrets,
        },
        monitorConfig,
        workspaceId,
      ),
    encryptionKey: config.encryptionKey,
    appUrl: config.appUrl,
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
        env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">,
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
      env.CHECK_QUEUE as Pick<Queue<CheckMessage>, "send">,
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
  );
}

export function buildHourlyJob(env: Bindings): HourlyMaintenance {
  const config = loadConfig(env);
  const subscriptions = new D1SubscriptionRepo(env.DB);
  const reports = new D1OverageReportRepo(env.DB);
  const usageEvents = new D1UsageEventRepo(env.DB);
  const overages = new SweepOverages(
    subscriptions,
    reports,
    new ReportOverageForPeriod(
      subscriptions,
      usageEvents,
      reports,
      new HttpPaddleClient(config.paddle),
      config.paddle.overagePriceId,
      systemClock,
      realIds,
    ),
    systemClock,
  );
  return new HourlyMaintenance(
    overages,
    new D1AttemptRepo(env.DB),
    new D1RunRepo(env.DB),
    buildAttemptLifecycle(env),
    new D1MonitorRepo(env.DB),
    systemClock,
  );
}

export async function scheduled(
  controller: ScheduledController,
  env: Bindings,
  _context: ExecutionContext,
): Promise<void> {
  await processScheduledCron(controller.cron, {
    ...buildSchedulerJobs(env),
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
    processDeadLetterBatch(batch);
    return;
  }
  switch (batch.queue) {
    case "zenguy-runs":
      await processAttemptBatch(batch, buildAttemptConsumer(env), context);
      return;
    case "zenguy-checks":
      await processCheckBatch(batch, buildCheckConsumer(env), context);
      return;
    case "zenguy-notify":
      await processNotifyBatch(batch, notifyConsumer(env));
      return;
    default:
      platformAlert("unsupported_queue", { queue: batch.queue });
      for (const message of batch.messages) message.retry();
  }
}

export default {
  fetch(request, env, context) {
    return buildApp(env).fetch(request, env, context);
  },
  queue,
  scheduled,
} satisfies ExportedHandler<Bindings>;
