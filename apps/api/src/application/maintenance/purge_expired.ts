import type { ArtifactRepo } from "../../domain/browser_tests/repo";
import type { CleanupRepo } from "../../domain/maintenance/repo";
import type { CheckRepo } from "../../domain/uptime/repo";
import type { Clock } from "../../shared/clock";
import { logEvent, type LogFields } from "../../shared/log";

export const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const BATCH_LIMIT = 200;

export interface CleanupCounts {
  runs: number;
  attempts: number;
  steps: number;
  artifacts: number;
  checks: number;
  deliveries: number;
  tokens: number;
}

export interface ArtifactDeleter {
  delete(keys: string[]): Promise<void>;
}

type EventLogger = (event: string, fields?: LogFields) => void;

function emptyCounts(): CleanupCounts {
  return {
    runs: 0,
    attempts: 0,
    steps: 0,
    artifacts: 0,
    checks: 0,
    deliveries: 0,
    tokens: 0,
  };
}

export class PurgeExpired {
  constructor(
    private readonly cleanup: CleanupRepo,
    private readonly artifacts: Pick<ArtifactRepo, "listExpired" | "deleteByIds">,
    private readonly checks: Pick<CheckRepo, "deleteOlderThan">,
    private readonly storage: ArtifactDeleter,
    private readonly clock: Clock,
    private readonly logger: EventLogger = logEvent,
  ) {}

  async execute(): Promise<CleanupCounts> {
    const now = this.clock.now();
    const retentionBefore = now - RETENTION_DAYS * DAY_MS;
    const counts = emptyCounts();

    while (true) {
      const expired = await this.cleanup.listExpiredRunBatch(
        retentionBefore,
        BATCH_LIMIT,
      );
      if (expired.runIds.length === 0) break;
      await this.storage.delete(expired.storageKeys);
      await this.cleanup.deleteRunBatch(expired.runIds);
      counts.runs += expired.counts.runs;
      counts.attempts += expired.counts.attempts;
      counts.steps += expired.counts.steps;
      counts.artifacts += expired.counts.artifacts;
    }

    while (true) {
      const expired = await this.artifacts.listExpired(now, BATCH_LIMIT);
      if (expired.length === 0) break;
      await this.storage.delete(expired.map((artifact) => artifact.storageKey));
      await this.artifacts.deleteByIds(expired.map((artifact) => artifact.id));
      counts.artifacts += expired.length;
    }

    while (true) {
      const deleted = await this.checks.deleteOlderThan(
        retentionBefore,
        BATCH_LIMIT,
      );
      counts.checks += deleted;
      if (deleted === 0) break;
    }

    while (true) {
      const deleted = await this.cleanup.deleteDeliveriesOlderThan(
        retentionBefore,
        BATCH_LIMIT,
      );
      counts.deliveries += deleted;
      if (deleted === 0) break;
    }

    while (true) {
      const deleted = await this.cleanup.deleteAuthDebris({
        emailBefore: now - 7 * DAY_MS,
        refreshBefore: retentionBefore,
        invitationBefore: retentionBefore,
        limit: BATCH_LIMIT,
      });
      const total =
        deleted.emailTokens + deleted.refreshTokens + deleted.invitations;
      counts.tokens += total;
      if (total === 0) break;
    }

    while (true) {
      const deleted = await this.cleanup.purgeDeletedWorkspaceOperational(
        retentionBefore,
        BATCH_LIMIT,
      );
      counts.tokens += deleted.invitations;
      if (deleted.workspaces === 0) break;
    }

    this.logger("cleanup", { ...counts });
    return counts;
  }
}
