import {
  validateAgentAction,
  type AgentAction,
  type LlmClient,
} from "../../domain/browser_tests/agent_types";
import type { RunSnapshot } from "../../domain/browser_tests/types";
import {
  extractPlaceholders,
  substitutePlaceholders,
} from "../../domain/secrets/rules";
import type { ResolvedSecrets } from "../../domain/secrets/types";
import { formatPageState } from "../../infrastructure/browser/serializer";
import {
  ActionError,
  type BrowserSession,
} from "../../infrastructure/browser/session";
import type { PageState } from "../../infrastructure/browser/types";
import { AGENT_SYSTEM_PROMPT } from "../../infrastructure/llm/system_prompt";
import type { Clock } from "../../shared/clock";
import {
  ATTEMPT_TIMEOUT_MS,
  MAX_AGENT_STEPS,
  MAX_SCREENSHOTS_PER_ATTEMPT,
} from "../../shared/constants";
import { isAppError } from "../../shared/errors";
import { type Redactor, sanitizeUrl, truncate } from "../../shared/redact";
import { assertSafeExternalUrl } from "../../shared/ssrf";

export interface AgentResult {
  status: "PASSED" | "FAILED" | "TIMEOUT";
  summary: string;
  expectedResult: string;
  actualResult: string;
  failureReason: string | null;
  steps: StepRecord[];
  tokensUsed: number;
}

export interface StepRecord {
  sequence: number;
  timestamp: number;
  actionType: string;
  description: string;
  urlSanitized: string | null;
  result: "OK" | "ERROR";
  screenshotJpeg: Uint8Array | null;
}

export interface RunAgentDependencies {
  session: BrowserSession;
  llm: LlmClient;
  clock: Clock;
  redactor: Redactor;
  secrets: ResolvedSecrets;
  onStep?: (step: StepRecord) => Promise<void>;
  llmUseVision?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface RunAgentInput {
  snapshot: RunSnapshot;
  deadlineAt: number;
  initialSteps?: StepRecord[];
}

interface ExecutionResult {
  result: "OK" | "ERROR";
  detail: string | null;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function safeResultText(redactor: Redactor, value: string): string {
  return truncate(redactor.redact(value), 2_000);
}

function redactedPageState(state: PageState, redactor: Redactor): PageState {
  return redactor.redactDeep(state);
}

function buildUserText(input: {
  snapshot: RunSnapshot;
  state: PageState;
  steps: StepRecord[];
  stepNumber: number;
  elapsedSeconds: number;
  redactor: Redactor;
}): string {
  const actionLog =
    input.steps.length === 0
      ? "(none yet)"
      : input.steps
          .map(
            (step) =>
              `${step.sequence}. ${step.actionType} → ${step.result}: ${oneLine(step.description)}`,
          )
          .join("\n");
  return [
    "MISSION",
    `Starting URL: ${input.redactor.redact(input.snapshot.startUrl)}`,
    "Instructions:",
    input.redactor.redact(input.snapshot.instructions),
    "",
    `Step ${input.stepNumber} of ${MAX_AGENT_STEPS}. Elapsed ${input.elapsedSeconds}s of 300s.`,
    "Action log:",
    actionLog,
    "",
    formatPageState(redactedPageState(input.state, input.redactor)),
  ].join("\n");
}

function typedDisplay(action: AgentAction, state: PageState): string {
  const text = action.text ?? "";
  const element = state.elements.find((candidate) => candidate.i === action.index);
  if (
    element?.type?.toLowerCase() === "password" &&
    extractPlaceholders(text).length === 0
  ) {
    return "[redacted]";
  }
  return text;
}

function actionDescription(
  action: AgentAction,
  state: PageState,
  redactor: Redactor,
): string {
  let detail: string;
  switch (action.action) {
    case "navigate":
      detail = `navigate to ${action.url ?? ""}`;
      break;
    case "click":
      detail = `click [${action.index ?? ""}]`;
      break;
    case "type":
      detail = `type: Typed "${typedDisplay(action, state)}" into [${action.index ?? ""}]`;
      break;
    case "select":
      detail = `select: Selected "${action.value ?? ""}" in [${action.index ?? ""}]`;
      break;
    case "press_key":
      detail = `press_key: Pressed "${action.key ?? ""}"`;
      break;
    case "scroll":
      detail = `scroll ${action.direction ?? ""}`;
      break;
    case "go_back":
      detail = "go_back";
      break;
    case "wait":
      detail = `wait ${action.seconds ?? ""}s`;
      break;
    case "finish":
      detail = "finish";
      break;
  }
  return oneLine(redactor.redact(`${action.thought} → ${detail}`));
}

export type NavigationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function navigateWithSecrets(
  session: BrowserSession,
  url: string,
  secrets: ResolvedSecrets,
): Promise<NavigationResult> {
  const substitution = substitutePlaceholders(url, secrets, hostOf(url));
  if (!substitution.ok) return { ok: false, error: substitution.reason };
  let destination: URL;
  try {
    destination = assertSafeExternalUrl(substitution.text);
  } catch (error) {
    if (isAppError(error) && error.code === "VALIDATION_ERROR") {
      return { ok: false, error: "Navigation blocked: URL not allowed" };
    }
    throw error;
  }
  await session.navigate(destination.href);
  return { ok: true };
}

async function executeAction(
  action: AgentAction,
  dependencies: RunAgentDependencies,
): Promise<ExecutionResult> {
  const { session, secrets } = dependencies;
  switch (action.action) {
    case "navigate": {
      const navigation = await navigateWithSecrets(
        session,
        action.url as string,
        secrets,
      );
      return navigation.ok
        ? { result: "OK", detail: null }
        : { result: "ERROR", detail: navigation.error };
    }
    case "click":
      await session.click(action.index as number);
      return { result: "OK", detail: null };
    case "type": {
      const substitution = substitutePlaceholders(
        action.text as string,
        secrets,
        hostOf(session.currentUrl()),
      );
      if (!substitution.ok) return { result: "ERROR", detail: substitution.reason };
      await session.type(action.index as number, substitution.text);
      return { result: "OK", detail: null };
    }
    case "select": {
      const substitution = substitutePlaceholders(
        action.value as string,
        secrets,
        hostOf(session.currentUrl()),
      );
      if (!substitution.ok) return { result: "ERROR", detail: substitution.reason };
      await session.select(action.index as number, substitution.text);
      return { result: "OK", detail: null };
    }
    case "press_key":
      await session.pressKey(action.key as string);
      return { result: "OK", detail: null };
    case "scroll":
      await session.scroll(action.direction as "up" | "down");
      return { result: "OK", detail: null };
    case "go_back":
      await session.goBack();
      return { result: "OK", detail: null };
    case "wait":
      await (dependencies.sleep ?? defaultSleep)((action.seconds as number) * 1_000);
      return { result: "OK", detail: null };
    case "finish":
      throw new Error("finish actions are not executable");
  }
}

async function captureStepScreenshot(
  dependencies: RunAgentDependencies,
  screenshotsStored: number,
): Promise<Uint8Array | null> {
  if (screenshotsStored >= MAX_SCREENSHOTS_PER_ATTEMPT) return null;
  return dependencies.session.screenshotJpeg();
}

async function recordStep(
  dependencies: RunAgentDependencies,
  steps: StepRecord[],
  input: {
    actionType: string;
    description: string;
    result: "OK" | "ERROR";
    screenshotJpeg: Uint8Array | null;
  },
): Promise<void> {
  const rawUrl = dependencies.session.currentUrl();
  const step: StepRecord = {
    sequence: steps.length + 1,
    timestamp: dependencies.clock.now(),
    actionType: dependencies.redactor.redact(input.actionType),
    description: oneLine(dependencies.redactor.redact(input.description)),
    urlSanitized:
      rawUrl.length === 0
        ? null
        : dependencies.redactor.redact(sanitizeUrl(rawUrl)),
    result: input.result,
    screenshotJpeg: input.screenshotJpeg,
  };
  steps.push(step);
  await dependencies.onStep?.(step);
}

export function agentTimeoutResult(
  snapshot: RunSnapshot,
  steps: StepRecord[],
  tokensUsed: number,
  redactor: Redactor,
): AgentResult {
  return {
    status: "TIMEOUT",
    summary: safeResultText(redactor, "Attempt exceeded the 5 minute limit"),
    expectedResult: safeResultText(redactor, snapshot.instructions),
    actualResult: safeResultText(redactor, "not verified"),
    failureReason: safeResultText(
      redactor,
      "Attempt timed out after 5 minutes",
    ),
    steps,
    tokensUsed,
  };
}

export async function runAgentAttempt(
  dependencies: RunAgentDependencies,
  input: RunAgentInput,
): Promise<AgentResult> {
  const steps: StepRecord[] = (input.initialSteps ?? []).map((step) => ({
    ...step,
    screenshotJpeg:
      step.screenshotJpeg === null
        ? null
        : new Uint8Array(step.screenshotJpeg),
  }));
  let tokensUsed = 0;
  let screenshotsStored = steps.filter(
    (step) => step.screenshotJpeg !== null,
  ).length;
  const startedAt = input.deadlineAt - ATTEMPT_TIMEOUT_MS;

  for (let index = 0; index < MAX_AGENT_STEPS; index += 1) {
    const now = dependencies.clock.now();
    if (now >= input.deadlineAt) {
      return agentTimeoutResult(
        input.snapshot,
        steps,
        tokensUsed,
        dependencies.redactor,
      );
    }

    const state = await dependencies.session.serialize();
    const llmScreenshot =
      dependencies.llmUseVision === false
        ? null
        : await dependencies.session.screenshotJpeg();
    const userText = buildUserText({
      snapshot: input.snapshot,
      state,
      steps,
      stepNumber: index + 1,
      elapsedSeconds: Math.max(0, Math.floor((now - startedAt) / 1_000)),
      redactor: dependencies.redactor,
    });
    const decision = await dependencies.llm.decideAction({
      system: AGENT_SYSTEM_PROMPT,
      userText,
      screenshotJpegBase64:
        llmScreenshot === null ? null : bytesToBase64(llmScreenshot),
    });
    tokensUsed += decision.tokensUsed;

    const validationError = validateAgentAction(decision.action);
    if (validationError !== null) {
      const screenshot = await captureStepScreenshot(
        dependencies,
        screenshotsStored,
      );
      if (screenshot !== null) screenshotsStored += 1;
      await recordStep(dependencies, steps, {
        actionType: decision.action.action,
        description: `invalid action: ${validationError}`,
        result: "ERROR",
        screenshotJpeg: screenshot,
      });
      continue;
    }

    if (decision.action.action === "finish") {
      let screenshot: Uint8Array | null = null;
      if (screenshotsStored < MAX_SCREENSHOTS_PER_ATTEMPT) {
        // The image supplied to the model is already the terminal page state.
        // Reuse it when available; text-only runs still capture final evidence.
        screenshot =
          llmScreenshot ?? (await dependencies.session.screenshotJpeg());
        screenshotsStored += 1;
      }
      await recordStep(dependencies, steps, {
        actionType: decision.action.action,
        description: actionDescription(
          decision.action,
          state,
          dependencies.redactor,
        ),
        result: "OK",
        screenshotJpeg: screenshot,
      });
      return {
        status: decision.action.outcome as "PASSED" | "FAILED",
        summary: safeResultText(
          dependencies.redactor,
          decision.action.summary as string,
        ),
        expectedResult: safeResultText(
          dependencies.redactor,
          decision.action.expected_result as string,
        ),
        actualResult: safeResultText(
          dependencies.redactor,
          decision.action.actual_result as string,
        ),
        failureReason:
          decision.action.outcome === "FAILED"
            ? safeResultText(
                dependencies.redactor,
                decision.action.failure_reason as string,
              )
            : null,
        steps,
        tokensUsed,
      };
    }

    const description = actionDescription(
      decision.action,
      state,
      dependencies.redactor,
    );
    let execution: ExecutionResult;
    try {
      execution = await executeAction(decision.action, dependencies);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      execution = { result: "ERROR", detail: error.message };
    }
    const screenshot = await captureStepScreenshot(
      dependencies,
      screenshotsStored,
    );
    if (screenshot !== null) screenshotsStored += 1;
    await recordStep(dependencies, steps, {
      actionType: decision.action.action,
      description:
        execution.detail === null
          ? description
          : `${description} — ${execution.detail}`,
      result: execution.result,
      screenshotJpeg: screenshot,
    });
  }

  return {
    status: "FAILED",
    summary: safeResultText(
      dependencies.redactor,
      "The agent did not complete and verify the goal",
    ),
    expectedResult: safeResultText(
      dependencies.redactor,
      input.snapshot.instructions,
    ),
    actualResult: safeResultText(dependencies.redactor, "not verified"),
    failureReason: safeResultText(
      dependencies.redactor,
      "The agent used all 40 steps without completing and verifying the goal",
    ),
    steps,
    tokensUsed,
  };
}
