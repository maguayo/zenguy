import type { OutboxRepo } from "../../domain/durability/repo";
import type { DurableQueueKind } from "../../domain/durability/types";
import {
  attemptMessageSchema,
  checkMessageSchema,
  notifyMessageSchema,
} from "../../domain/queues";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { platformAlert } from "../../shared/log";
import { createOutboxEntry } from "./factory";
import type { PublishQueueOutbox } from "./publish_outbox";

const MAX_REDRIVES = 5;

type Publisher = Pick<PublishQueueOutbox, "publishById">;

function dlqKind(queueName: string): DurableQueueKind | null {
  switch (queueName) {
    case "zenguy-local-runs-dlq":
    case "zenguy-runs-dlq":
    case "zenguy-staging-runs-dlq":
      return "RUN";
    case "zenguy-local-checks-dlq":
    case "zenguy-checks-dlq":
    case "zenguy-staging-checks-dlq":
      return "CHECK";
    case "zenguy-local-notify-dlq":
    case "zenguy-notify-dlq":
    case "zenguy-staging-notify-dlq":
      return "NOTIFY";
    default:
      return null;
  }
}

function parseBody(kind: DurableQueueKind, body: unknown) {
  if (kind === "RUN") return attemptMessageSchema.safeParse(body);
  if (kind === "CHECK") return checkMessageSchema.safeParse(body);
  return notifyMessageSchema.safeParse(body);
}

function retryDelayMs(redriveCount: number): number {
  return Math.min(300_000, 30_000 * 2 ** redriveCount);
}

/**
 * Persists a DLQ message before acknowledging it. A crash before persistence
 * leaves the DLQ delivery retryable; a crash after persistence is deduplicated
 * by the original DLQ message id and recovered by the normal outbox sweeper.
 */
export class RedriveDeadLetter {
  constructor(
    private readonly outbox: OutboxRepo,
    private readonly publisher: Publisher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    queueName: string,
    message: Pick<Message<unknown>, "id" | "body" | "ack">,
  ): Promise<void> {
    const queueKind = dlqKind(queueName);
    if (queueKind === null) {
      platformAlert("unsupported_dlq", {
        queue: queueName,
        messageId: message.id,
      });
      // Never acknowledge a queue we cannot classify. The configured DLQ
      // retry/quarantine chain must retain it for operator inspection.
      throw new Error(`Unsupported dead-letter queue: ${queueName}`);
    }

    const now = this.clock.now();
    const parsed = parseBody(queueKind, message.body);
    const currentCount = parsed.success
      ? (parsed.data.redriveCount ?? 0)
      : 0;
    const payload = parsed.success
      ? { ...parsed.data, redriveCount: currentCount + 1 }
      : (message.body ?? null);
    const candidate = createOutboxEntry({
      dedupeKey: `dlq:${queueName}:${message.id}`,
      queueKind,
      payload,
      availableAt: now + retryDelayMs(currentCount),
      now,
      ids: this.ids,
    });

    // This insert is the durability boundary. Let it throw so the caller asks
    // Cloudflare Queues to retry the DLQ delivery without acknowledging it.
    const persisted = await this.outbox.insertOutbox(candidate);

    if (!parsed.success) {
      await this.outbox.quarantineOutbox(
        persisted.id,
        now,
        "DLQ payload does not match its queue schema",
      );
      platformAlert("dlq_message_quarantined", {
        queue: queueName,
        messageId: message.id,
        outboxId: persisted.id,
        reason: "invalid_payload",
      });
      message.ack();
      return;
    }

    if (currentCount >= MAX_REDRIVES) {
      await this.outbox.quarantineOutbox(
        persisted.id,
        now,
        `DLQ message exceeded ${MAX_REDRIVES} redrives`,
      );
      platformAlert("dlq_message_quarantined", {
        queue: queueName,
        messageId: message.id,
        outboxId: persisted.id,
        reason: "redrive_limit",
      });
      message.ack();
      return;
    }

    try {
      await this.publisher.publishById(persisted.id);
    } catch {
      // The outbox row is already durable. Normal maintenance will retry it
      // with backoff, so acknowledging the DLQ delivery cannot lose the work.
      platformAlert("dlq_redrive_publish_deferred", {
        queue: queueName,
        messageId: message.id,
        outboxId: persisted.id,
      });
    }
    message.ack();
  }
}
