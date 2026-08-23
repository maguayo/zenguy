import type { TrackEvent } from "../activity/track_event";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { BrowserTestRepo } from "../../domain/browser_tests/repo";
import type { BrowserTestConfig } from "../../domain/browser_tests/rules";
import {
  parseTestsFile,
  type ParsedBrowserTestTransferEntry,
} from "../../domain/browser_tests/transfer";
import type { ChannelRepo } from "../../domain/channels/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import {
  forbidden,
  validation,
  type ValidationDetail,
} from "../../shared/errors";
import {
  enforceRateLimitScopes,
  normalizeRateLimitAddress,
  type RateLimiter,
} from "../../shared/ratelimit";
import type { CreateBrowserTest } from "./create_browser_test";
import type { BrowserTestOutput } from "./types";
import type { UpdateBrowserTest } from "./update_browser_test";

export interface ImportSummary {
  created: number;
  updated: number;
  tests: BrowserTestOutput[];
}

interface ImportStep {
  config: BrowserTestConfig;
  existingId: string | null;
}

function entryConfig(entry: ParsedBrowserTestTransferEntry): BrowserTestConfig {
  return {
    name: entry.name,
    allowedDomains: [...entry.allowedDomains],
    writableDomains: [...entry.writableDomains],
    testDataAttested: entry.testDataAttested,
    irreversibleActionScopes: structuredClone(
      entry.irreversibleActionScopes,
    ),
    allowReversibleWrites: entry.allowReversibleWrites,
    startUrl: entry.startUrl,
    instructions: entry.instructions,
    device: entry.device,
    intervalHours: entry.intervalHours,
    maxRetries: entry.maxRetries,
    notifyOnRecovery: entry.notifyOnRecovery,
    channelIds: entry.channelIds,
  };
}

export class ImportBrowserTests {
  constructor(
    private readonly createTest: Pick<CreateBrowserTest, "execute">,
    private readonly updateTest: Pick<UpdateBrowserTest, "execute">,
    private readonly tests: BrowserTestRepo,
    private readonly channels: ChannelRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly rateLimiter: RateLimiter,
    private readonly track?: Pick<TrackEvent, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    fileText: string;
    ip?: string;
  }): Promise<ImportSummary> {
    if (!can(input.actorRole, "tests.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    await this.enforceRate(input);
    const file = parseTestsFile(input.fileText);
    const steps = await this.resolveSteps(input.workspaceId, file.tests);
    let created = 0;
    let updated = 0;
    const results: BrowserTestOutput[] = [];
    for (const step of steps) {
      if (step.existingId === null) {
        results.push(
          await this.createTest.execute({
            workspaceId: input.workspaceId,
            actor: input.actor,
            actorRole: input.actorRole,
            config: step.config,
            ip: input.ip,
          }),
        );
        created += 1;
      } else {
        results.push(
          await this.updateTest.execute({
            workspaceId: input.workspaceId,
            testId: step.existingId,
            actor: input.actor,
            actorRole: input.actorRole,
            changes: step.config,
            ip: input.ip,
          }),
        );
        updated += 1;
      }
    }
    await this.track?.execute({
      type: ACTIVITY_EVENTS.browserTestImported,
      userId: input.actor.id,
      workspaceId: input.workspaceId,
      source: "server",
      properties: { created, updated },
    });
    return { created, updated, tests: results };
  }

  // Validates every entry before the first write so a bad file changes
  // nothing. Ids from the file are only trusted when they resolve inside this
  // workspace; unknown or foreign ids fall back to creating a fresh test.
  private async resolveSteps(
    workspaceId: string,
    entries: ParsedBrowserTestTransferEntry[],
  ): Promise<ImportStep[]> {
    const details: ValidationDetail[] = [];
    const referenced = [...new Set(entries.flatMap((entry) => entry.channelIds))];
    const known = new Set(
      (await this.channels.listByIds(workspaceId, referenced)).map(
        (channel) => channel.id,
      ),
    );
    const steps: ImportStep[] = [];
    for (const [index, entry] of entries.entries()) {
      if (entry.channelIds.some((id) => !known.has(id))) {
        details.push({
          field: `tests.${index}.channelIds`,
          message: "Every channel must belong to this workspace",
        });
      }
      const existing =
        entry.id === undefined
          ? null
          : await this.tests.findById(workspaceId, entry.id);
      steps.push({ config: entryConfig(entry), existingId: existing?.id ?? null });
    }
    if (details.length > 0) throw validation(details);
    return steps;
  }

  private async enforceRate(input: {
    workspaceId: string;
    actor: User;
    ip?: string;
  }): Promise<void> {
    await enforceRateLimitScopes(
      this.rateLimiter,
      [
        `test_import:workspace:${input.workspaceId}`,
        `test_import:actor:${input.actor.id}`,
        `test_import:ip:${await sha256Hex(normalizeRateLimitAddress(input.ip))}`,
      ],
      RATE_LIMITS.test_import,
    );
  }
}
