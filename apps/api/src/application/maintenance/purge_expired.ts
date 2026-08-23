import { activityEventTypesByVolume } from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { ArtifactRepo } from "../../domain/browser_tests/repo";
import type { CleanupRepo } from "../../domain/maintenance/repo";
import type { CheckRepo } from "../../domain/uptime/repo";
import type { Clock } from "../../shared/clock";
import { logEvent, type LogFields } from "../../shared/log";

export const RETENTION_DAYS = 30;
/** Activity events are kept per catalog volume: noisy visits/executions 90 days, the rest a year. */
export const ACTIVITY_RETENTION_DAYS = { high: 90, normal: 365 } as const;
const DAY_MS = 86_400_000;
const BATCH_LIMIT = 200;

export interface CleanupCounts {
  runs: number;
  attempts: number;
  steps: number;
  artifacts: number;
  checks: number;
  deliveries: number;
  rateLimits: number;
  tokens: number;
  activityEvents: number;
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
    rateLimits: 0,
    tokens: 0,
    activityEvents: 0,
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
    private readonly activity: Pick<ActivityEventRepo, "deleteOlderThan"> | null = null,
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
      const deleted = await this.cleanup.deleteExpiredRateLimits(
        now,
        BATCH_LIMIT,
      );
      counts.rateLimits += deleted;
      if (deleted === 0) break;
    }

    while (true) {
      const deleted = await this.cleanup.deleteAuthDebris({
        emailBefore: now - 7 * DAY_MS,
        refreshBefore: retentionBefore,
        invitationBefore: retentionBefore,
        adminSessionBefore: now,
        limit: BATCH_LIMIT,
      });
      const total =
        deleted.emailTokens +
        deleted.refreshTokens +
        deleted.invitations +
        deleted.adminSessions;
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

    if (this.activity !== null) {
      for (const volume of ["high", "normal"] as const) {
        const before = now - ACTIVITY_RETENTION_DAYS[volume] * DAY_MS;
        const types = activityEventTypesByVolume(volume);
        while (true) {
          const deleted = await this.activity.deleteOlderThan(
            before,
            types,
            BATCH_LIMIT,
          );
          counts.activityEvents += deleted;
          if (deleted === 0) break;
        }
      }
    }

    this.logger("cleanup", { ...counts });
    return counts;
  }
}
