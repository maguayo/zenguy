import type { OutboxRepo } from "../../domain/durability/repo";
import type { DurableQueueKind } from "../../domain/durability/types";
import type {
  AttemptMessage,
  CheckMessage,
  NotifyMessage,
} from "../../domain/queues";
import type { Clock } from "../../shared/clock";
import { platformAlert } from "../../shared/log";
import { validateOutboxPayload } from "../../domain/durability/schemas";

const CLAIM_LEASE_MS = 5 * 60_000;

export interface DurableQueueProducers {
  RUN: Pick<Queue<AttemptMessage>, "send">;
  CHECK: Pick<Queue<CheckMessage>, "send">;
  NOTIFY: Pick<Queue<NotifyMessage>, "send">;
}

export class PublishQueueOutbox {
  constructor(
    private readonly outbox: OutboxRepo,
    private readonly queues: DurableQueueProducers,
    private readonly clock: Clock,
  ) {}

  async publishById(id: string): Promise<boolean> {
    const claimedAt = this.clock.now();
    const entry = await this.outbox.claimById(
      id,
      claimedAt,
      claimedAt - CLAIM_LEASE_MS,
    );
    if (entry === null) return false;
    const parsed = validateOutboxPayload(entry);
    if (!parsed.success) {
      await this.outbox.quarantineOutbox(entry.id, claimedAt, parsed.reason);
      platformAlert("queue_outbox_quarantined", {
        outboxId: entry.id,
        queueKind: entry.queueKind,
        reason: parsed.reason,
      });
      return false;
    }
    try {
      const delaySeconds = Math.max(
        0,
        Math.ceil((entry.availableAt - claimedAt) / 1_000),
      );
      await this.send(entry.queueKind, parsed.value, delaySeconds);
      await this.outbox.markPublished(entry.id, this.clock.now());
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      const disposition = await this.outbox.recordOutboxFailure(
        entry.id,
        this.clock.now(),
        reason,
      );
      platformAlert("queue_outbox_publish_failed", {
        outboxId: entry.id,
        queueKind: entry.queueKind,
        error: reason,
        disposition,
      });
      throw error;
    }
  }

  async flush(limit = 100): Promise<{ published: number; failed: number }> {
    const now = this.clock.now();
    const entries = await this.outbox.listPending(
      limit,
      now,
      now - CLAIM_LEASE_MS,
    );
    const results = await Promise.allSettled(
      entries.map((entry) => this.publishById(entry.id)),
    );
    return results.reduce(
      (counts, result) => {
        if (result.status === "fulfilled" && result.value) counts.published += 1;
        if (result.status === "rejected") counts.failed += 1;
        return counts;
      },
      { published: 0, failed: 0 },
    );
  }

  private async send(
    queueKind: DurableQueueKind,
    body: unknown,
    delaySeconds: number,
  ): Promise<void> {
    const options = { delaySeconds };
    if (queueKind === "RUN") {
      await this.queues.RUN.send(body as AttemptMessage, options);
      return;
    }
    if (queueKind === "CHECK") {
      await this.queues.CHECK.send(body as CheckMessage, options);
      return;
    }
    await this.queues.NOTIFY.send(body as NotifyMessage, options);
  }
}
