import type {
  DurableWorkflowRepo,
  OutboxRepo,
} from "../../domain/durability/repo";
import type { Clock } from "../../shared/clock";
import { platformAlert } from "../../shared/log";
import type { AttemptLifecycle } from "../execution/attempt_lifecycle";
import type { HandleCheckMessage } from "../uptime/handle_check_message";
import type { PublishQueueOutbox } from "./publish_outbox";

const RETENTION_MS = 30 * 86_400_000;
const PURGE_LIMIT = 500;

export class DurableWorkflowMaintenance {
  constructor(
    private readonly attempts: Pick<AttemptLifecycle, "resumePendingJobs">,
    private readonly checks: Pick<HandleCheckMessage, "resumePendingJobs">,
    private readonly publisher: Pick<PublishQueueOutbox, "flush">,
    private readonly outbox: Pick<
      OutboxRepo,
      "purgePublished" | "purgeQuarantinedOutbox"
    >,
    private readonly workflows: Pick<
      DurableWorkflowRepo,
      "purgeCompleted" | "purgeQuarantinedJobs"
    >,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<{
    published: number;
    failed: number;
    purgedOutbox: number;
    purgedJobs: number;
    purgedQuarantinedOutbox: number;
    purgedQuarantinedJobs: number;
  }> {
    const continuations = await Promise.allSettled([
      this.attempts.resumePendingJobs(),
      this.checks.resumePendingJobs(),
    ]);
    if (continuations.some((result) => result.status === "rejected")) {
      platformAlert("durable_continuation_failed");
    }
    const published = await this.publisher.flush();
    const before = this.clock.now() - RETENTION_MS;
    const [
      purgedOutbox,
      purgedJobs,
      purgedQuarantinedOutbox,
      purgedQuarantinedJobs,
    ] = await Promise.all([
      this.outbox.purgePublished(before, PURGE_LIMIT),
      this.workflows.purgeCompleted(before, PURGE_LIMIT),
      this.outbox.purgeQuarantinedOutbox(before, PURGE_LIMIT),
      this.workflows.purgeQuarantinedJobs(before, PURGE_LIMIT),
    ]);
    return {
      ...published,
      purgedOutbox,
      purgedJobs,
      purgedQuarantinedOutbox,
      purgedQuarantinedJobs,
    };
  }
}
