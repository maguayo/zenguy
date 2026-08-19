import { buildApp } from "./app";
import { RecordRunUsage } from "./application/billing/record_run_usage";
import { ReverseRunUsage } from "./application/billing/reverse_run_usage";
import { DispatchNotifications } from "./application/channels/dispatch_notifications";
import {
  SendQueuedNotification,
  type NotificationQueueControl,
} from "./application/channels/send_queued_notification";
import { AttemptLifecycle } from "./application/execution/attempt_lifecycle";
import { ExecuteAttempt } from "./application/execution/execute_attempt";
import { HandleRunFinalized } from "./application/incidents/handle_run_finalized";
import { WriteIncidentNotificationEvent } from "./application/incidents/write_notification_event";
import { ResolveSecrets } from "./application/secrets/resolve_secrets";
import { NoopReportGenerator } from "./domain/browser_tests/ports";
import {
  attemptMessageSchema,
  notifyMessageSchema,
  type AttemptMessage,
} from "./domain/queues";
import { launchSession } from "./infrastructure/browser/session";
import { D1ArtifactRepo } from "./infrastructure/db/artifact_repo";
import { D1AttemptRepo } from "./infrastructure/db/attempt_repo";
import { D1BrowserTestRepo } from "./infrastructure/db/browser_test_repo";
import { D1ChannelRepo } from "./infrastructure/db/channel_repo";
import { D1DeliveryRepo } from "./infrastructure/db/delivery_repo";
import { D1IncidentEventRepo } from "./infrastructure/db/incident_event_repo";
import { D1IncidentRepo } from "./infrastructure/db/incident_repo";
import { D1RunRepo } from "./infrastructure/db/run_repo";
import { D1SecretRepo } from "./infrastructure/db/secret_repo";
import { D1StepRepo } from "./infrastructure/db/step_repo";
import { D1UsageEventRepo } from "./infrastructure/db/usage_event_repo";
import { D1WorkspaceRepo } from "./infrastructure/db/workspace_repo";
import { buildEmailSender } from "./infrastructure/email";
import { OpenAiLlmClient } from "./infrastructure/llm/openai";
import { buildChannelSender } from "./infrastructure/notify";
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
  execute(message: unknown, context: ExecutionContext): Promise<void>;
}

export interface QueueConsumers {
  attempts: AttemptQueueConsumer;
  checks: CheckQueueConsumer;
  notifications: NotifyConsumer;
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
  // CheckMessage and its schema arrive with the uptime domain in BE-062.
  // Until then this is deliberately a typed-unknown routing seam.
  for (const queueMessage of batch.messages) {
    try {
      await consumer.execute(queueMessage.body, context);
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

function notifyConsumer(env: Bindings): SendQueuedNotification {
  const config = loadConfig(env);
  const emailSender = buildEmailSender(config);
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

export function buildAttemptConsumer(env: Bindings): ExecuteAttempt {
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
  const dispatchNotifications = new DispatchNotifications(
    channels,
    deliveries,
    env.NOTIFY_QUEUE as Pick<Queue, "send">,
    systemClock,
    realIds,
  );
  const lifecycle = new AttemptLifecycle({
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
      reports: new NoopReportGenerator(),
      appUrl: config.appUrl,
      clock: systemClock,
      ids: realIds,
    }),
  });
  return new ExecuteAttempt({
    lifecycle,
    runs,
    attempts,
    steps,
    artifacts,
    storage,
    resolveSecrets: new ResolveSecrets(
      new D1SecretRepo(env.DB),
      config.encryptionKey,
    ),
    launchSession: (device) => launchSession(env.BROWSER, device),
    llm: new OpenAiLlmClient(config),
    llmUseVision: config.llmUseVision,
    clock: systemClock,
    ids: realIds,
  });
}

const pendingCheckConsumer: CheckQueueConsumer = {
  async execute() {
    // Replaced by the concrete uptime check consumer in BE-064.
    throw new Error("check consumer not available");
  },
};

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
      await processCheckBatch(batch, pendingCheckConsumer, context);
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
} satisfies ExportedHandler<Bindings>;
