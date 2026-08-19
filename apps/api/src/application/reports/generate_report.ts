import type {
  ArtifactRepo,
  AttemptRepo,
  StepRepo,
} from "../../domain/browser_tests/repo";
import type { ReportGenerator } from "../../domain/browser_tests/ports";
import type {
  RunArtifact,
  RunStep,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import { extractPlaceholders } from "../../domain/secrets/rules";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import { slugify } from "../../domain/workspaces/slug";
import type { ResolveSecrets } from "../secrets/resolve_secrets";
import { buildRedactor } from "../secrets/resolve_secrets";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import { artifactStorageKey } from "../../infrastructure/storage/artifacts";
import type { Clock } from "../../shared/clock";
import { RETENTION_DAYS } from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { Redactor, sanitizeUrl } from "../../shared/redact";
import { formatDuration } from "../../domain/channels/templates";

const DAY_MS = 86_400_000;
const REPORT_FOOTER =
  "> This report describes what was observed during the test. It contains no credentials and does not assert an unverified root cause. Secret values are redacted as {{KEY}} placeholders.";

export interface GenerateReportDependencies {
  attempts: Pick<AttemptRepo, "listForRun">;
  steps: Pick<StepRepo, "listForAttempt">;
  artifacts: Pick<
    ArtifactRepo,
    "findReportForRun" | "listForRun" | "insert"
  >;
  workspaces: Pick<WorkspaceRepo, "findById">;
  resolveSecrets: Pick<ResolveSecrets, "execute">;
  storage: Pick<ArtifactStorage, "put" | "delete">;
  clock: Clock;
  ids: IdGenerator;
}

interface ConsoleReportEntry {
  level: string;
  message: string;
}

interface NetworkReportEntry {
  method: string;
  host: string;
  path: string;
  status: string;
  error: string;
}

function parseArray(value: string | null): unknown[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string, fallback = ""): string {
  if (!isRecord(value)) return fallback;
  const field = value[key];
  return typeof field === "string" ? field : fallback;
}

function scalarField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" || typeof field === "number"
    ? String(field)
    : "";
}

function inline(redactor: Redactor, value: string | null | undefined): string {
  return redactor.redact(value).replace(/\s+/gu, " ").trim();
}

function markdownTableCell(redactor: Redactor, value: string): string {
  return inline(redactor, value).replaceAll("|", "\\|");
}

function safeUrl(redactor: Redactor, value: string): string {
  return sanitizeUrl(redactor.redact(value))
    .replace(/%7B%7B/giu, "{{")
    .replace(/%7D%7D/giu, "}}");
}

function fenced(value: string): string {
  const runs = value.match(/`+/gu) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${value}\n${fence}`;
}

function timeOfDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 19);
}

function reportDate(run: TestRun, now: number): number {
  return run.finishedAt ?? now;
}

function finalAttempt(attempts: TestAttempt[]): TestAttempt | null {
  return attempts.at(-1) ?? null;
}

function consoleEntries(
  attempts: TestAttempt[],
  redactor: Redactor,
): ConsoleReportEntry[] {
  return attempts.flatMap((attempt) =>
    parseArray(attempt.consoleErrorsJson).map((entry) => ({
      level: markdownTableCell(redactor, stringField(entry, "level", "unknown")),
      message: markdownTableCell(
        redactor,
        isRecord(entry) ? stringField(entry, "message", JSON.stringify(entry)) : String(entry),
      ),
    })),
  );
}

function networkEntries(
  attempts: TestAttempt[],
  redactor: Redactor,
): NetworkReportEntry[] {
  return attempts.flatMap((attempt) =>
    parseArray(attempt.networkErrorsJson).map((entry) => ({
      method: markdownTableCell(redactor, stringField(entry, "method", "unknown")),
      host: markdownTableCell(redactor, stringField(entry, "host", "unknown")),
      path: markdownTableCell(redactor, stringField(entry, "path", "")),
      status: markdownTableCell(redactor, scalarField(entry, "statusCode") || "—"),
      error: markdownTableCell(redactor, stringField(entry, "errorType", "—")),
    })),
  );
}

function screenshotSequence(
  artifact: RunArtifact,
  stepsByArtifact: Map<string, RunStep>,
): number {
  const linked = stepsByArtifact.get(artifact.id);
  if (linked !== undefined) return linked.sequence;
  if (artifact.metadataJson !== null) {
    try {
      const metadata: unknown = JSON.parse(artifact.metadataJson);
      if (
        isRecord(metadata) &&
        typeof metadata.sequence === "number" &&
        Number.isSafeInteger(metadata.sequence)
      ) {
        return metadata.sequence;
      }
    } catch {
      // Fall through to a stable unknown sequence marker.
    }
  }
  return 0;
}

export function buildFailureReport(input: {
  run: TestRun;
  attempts: TestAttempt[];
  stepsByAttempt: Map<string, RunStep[]>;
  artifacts: RunArtifact[];
  workspaceTimezone: string;
  redactor: Redactor;
  now: number;
}): string {
  const { run, attempts, stepsByAttempt, artifacts, redactor } = input;
  const lastAttempt = finalAttempt(attempts);
  const date = reportDate(run, input.now);
  const visitedUrls = [
    ...new Set(
      attempts.flatMap((attempt) =>
        parseArray(attempt.visitedUrlsJson)
          .filter((value): value is string => typeof value === "string")
          .map((url) => safeUrl(redactor, url)),
      ),
    ),
  ];
  const consoles = consoleEntries(attempts, redactor);
  const networks = networkEntries(attempts, redactor);
  const allSteps = [...stepsByAttempt.values()].flat();
  const stepsByArtifact = new Map(
    allSteps.flatMap((step) =>
      step.artifactId === null ? [] : [[step.artifactId, step] as const],
    ),
  );
  const attemptIndexes = new Map(
    attempts.map((attempt) => [attempt.id, attempt.attemptIndex]),
  );
  const screenshots = artifacts
    .filter(
      (artifact) =>
        artifact.type === "SCREENSHOT" && artifact.attemptId !== null,
    )
    .sort((left, right) => {
      const leftAttempt = attemptIndexes.get(left.attemptId as string) ?? 0;
      const rightAttempt = attemptIndexes.get(right.attemptId as string) ?? 0;
      return (
        leftAttempt - rightAttempt ||
        screenshotSequence(left, stepsByArtifact) -
          screenshotSequence(right, stepsByArtifact) ||
        left.id.localeCompare(right.id)
      );
    });
  const lines: string[] = [
    `# Test failure report: ${inline(redactor, run.snapshot.name || "draft")}`,
    "",
    `**Run ID:** ${run.id}`,
    `**Date:** ${new Date(date).toISOString()} (UTC)`,
    `**Workspace timezone:** ${inline(redactor, input.workspaceTimezone)}`,
    `**Source:** ${run.source}`,
    `**Starting URL:** ${safeUrl(redactor, run.snapshot.startUrl)}`,
    `**Device:** ${run.snapshot.device} (${run.snapshot.viewport.width}×${run.snapshot.viewport.height})`,
    "",
    "## Instructions",
    "",
    fenced(redactor.redact(run.snapshot.instructions)),
    "",
    "## Result",
    "",
    `Final status: ${run.status}`,
    `Total duration: ${formatDuration(run.durationMs ?? 0)}`,
    `Attempts: ${attempts.length}`,
    `Passed after retry: ${run.passedAfterRetry ? "yes" : "no"}`,
    "",
    "## Failure summary",
    "",
    inline(redactor, lastAttempt?.summary) || "_not captured_",
    "",
    `Failure reason: ${inline(redactor, lastAttempt?.failureReason) || "_not captured_"}`,
    "",
    "## Expected",
    "",
    inline(redactor, lastAttempt?.expectedResult) || "_not captured_",
    "",
    "## Observed",
    "",
    inline(redactor, lastAttempt?.actualResult) || "_not captured_",
    "",
    "## Steps",
    "",
  ];

  if (attempts.length === 0) lines.push("_none captured_");
  for (const attempt of attempts) {
    lines.push(
      `### Attempt ${attempt.attemptIndex} (${attempt.status}, ${formatDuration(attempt.durationMs ?? 0)}, waited ${attempt.retryDelaySeconds}s)`,
      "",
    );
    const steps = stepsByAttempt.get(attempt.id) ?? [];
    if (steps.length === 0) {
      lines.push("_none captured_", "");
      continue;
    }
    for (const step of steps) {
      const location =
        step.urlSanitized === null
          ? ""
          : ` (${safeUrl(redactor, step.urlSanitized)})`;
      lines.push(
        `${step.sequence}. [${timeOfDay(step.timestamp)}] ${inline(redactor, step.actionType)} — ${inline(redactor, step.description)}${location}`,
      );
    }
    lines.push("");
  }

  lines.push("## Visited URLs", "");
  lines.push(
    ...(visitedUrls.length === 0
      ? ["_none captured_"]
      : visitedUrls.map((url) => `- ${url}`)),
    "",
    "## Console errors",
    "",
  );
  if (consoles.length === 0) {
    lines.push("_none captured_");
  } else {
    lines.push(
      "| level | message |",
      "|---|---|",
      ...consoles.map((entry) => `| ${entry.level} | ${entry.message} |`),
    );
  }

  lines.push("", "## Network errors", "");
  if (networks.length === 0) {
    lines.push("_none captured_");
  } else {
    lines.push(
      "| method | host | path | status | error |",
      "|---|---|---|---|---|",
      ...networks.map(
        (entry) =>
          `| ${entry.method} | ${entry.host} | ${entry.path} | ${entry.status} | ${entry.error} |`,
      ),
    );
  }

  lines.push("", "## Screenshots", "");
  lines.push(
    ...(screenshots.length === 0
      ? ["_none captured_"]
      : screenshots.map((artifact) => {
          const attemptIndex =
            attemptIndexes.get(artifact.attemptId as string) ?? 0;
          const sequence = screenshotSequence(artifact, stepsByArtifact);
          return `- Attempt ${attemptIndex}, step ${sequence}: {{ARTIFACT:${artifact.id}}}`;
        })),
    "",
    "## Retries",
    "",
  );
  const retries = attempts.filter((attempt) => attempt.attemptIndex > 0);
  lines.push(
    ...(retries.length === 0
      ? ["_none_"]
      : retries.map(
          (attempt) =>
            `- Attempt ${attempt.attemptIndex}: ${attempt.status} — ${inline(redactor, attempt.failureReason) || "no failure reason captured"}`,
        )),
    "",
    "## Technical metadata",
    "",
    `- Model: ${inline(redactor, lastAttempt?.modelName) || "unknown"}`,
    `- Runner version: ${inline(redactor, lastAttempt?.runnerVersion) || "unknown"}`,
    `- Token usage: ${attempts.reduce((sum, attempt) => sum + (attempt.tokenUsage ?? 0), 0)}`,
    `- Run ID: ${run.id}`,
    `- Attempt IDs: ${attempts.map((attempt) => attempt.id).join(", ") || "none"}`,
    "",
    REPORT_FOOTER,
  );

  return `${lines.join("\n")}\n`;
}

export class GenerateReport implements ReportGenerator {
  constructor(private readonly dependencies: GenerateReportDependencies) {}

  async generateForRun(run: TestRun): Promise<RunArtifact | null> {
    if (run.status !== "FAILED" && run.status !== "TIMEOUT") return null;
    const existing = await this.dependencies.artifacts.findReportForRun(run.id);
    if (existing !== null) return existing;

    const [attempts, workspace, screenshots, secrets] = await Promise.all([
      this.dependencies.attempts.listForRun(run.id),
      this.dependencies.workspaces.findById(run.workspaceId, true),
      this.dependencies.artifacts.listForRun(run.id),
      this.dependencies.resolveSecrets.execute({
        workspaceId: run.workspaceId,
        referencedKeys: extractPlaceholders(
          `${run.snapshot.instructions} ${run.snapshot.startUrl}`,
        ),
      }),
    ]);
    if (workspace === null) throw new Error("Report workspace not found");
    const lastAttempt = finalAttempt(attempts);
    if (lastAttempt === null) throw new Error("Report attempt not found");
    const stepLists = await Promise.all(
      attempts.map((attempt) =>
        this.dependencies.steps.listForAttempt(attempt.id),
      ),
    );
    const stepsByAttempt = new Map(
      attempts.map((attempt, index) => [attempt.id, stepLists[index] ?? []]),
    );
    const redactor = buildRedactor(secrets);
    const now = this.dependencies.clock.now();
    const markdown = buildFailureReport({
      run,
      attempts,
      stepsByAttempt,
      artifacts: screenshots,
      workspaceTimezone: workspace.timezone,
      redactor,
      now,
    });
    const reportId = this.dependencies.ids.newId("art");
    const filenameDate = new Date(reportDate(run, now))
      .toISOString()
      .slice(0, 10);
    const reportName = run.snapshot.name.trim() || "draft";
    const filename = `${slugify(reportName)}_${filenameDate}_${run.id}_failure-report.md`;
    const storageKey = artifactStorageKey({
      workspaceId: run.workspaceId,
      runId: run.id,
      attemptId: lastAttempt.id,
      artifactId: reportId,
      type: "MARKDOWN_REPORT",
    });
    const bytes = new TextEncoder().encode(markdown);
    const stored = await this.dependencies.storage.put(
      storageKey,
      bytes,
      "text/markdown",
    );
    const artifact: RunArtifact = {
      id: reportId,
      workspaceId: run.workspaceId,
      runId: run.id,
      attemptId: lastAttempt.id,
      type: "MARKDOWN_REPORT",
      storageKey,
      mimeType: "text/markdown",
      sizeBytes: stored.sizeBytes,
      metadataJson: JSON.stringify({ filename }),
      createdAt: now,
      expiresAt: now + RETENTION_DAYS * DAY_MS,
    };
    try {
      await this.dependencies.artifacts.insert(artifact);
    } catch (error) {
      await this.dependencies.storage.delete([storageKey]).catch(() => undefined);
      throw error;
    }
    return artifact;
  }
}

export { REPORT_FOOTER };
