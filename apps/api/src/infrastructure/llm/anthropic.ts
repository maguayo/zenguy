import type { AppConfig } from "../../shared/config";
import {
  agentActionSchema,
  type AgentAction,
  type LlmClient,
} from "../../domain/browser_tests/agent_types";

export type { LlmClient } from "../../domain/browser_tests/agent_types";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [1_000, 4_000] as const;

export const AGENT_ACTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["thought", "action"],
  properties: {
    thought: { type: "string", minLength: 1 },
    action: {
      type: "string",
      enum: [
        "navigate",
        "click",
        "type",
        "select",
        "press_key",
        "scroll",
        "go_back",
        "wait",
        "finish",
      ],
    },
    url: { type: "string" },
    index: { type: "integer", minimum: 0 },
    text: { type: "string" },
    value: { type: "string" },
    key: { type: "string" },
    direction: { type: "string", enum: ["up", "down"] },
    seconds: { type: "number", minimum: 0, maximum: 10 },
    outcome: { type: "string", enum: ["PASSED", "FAILED"] },
    summary: { type: "string" },
    expected_result: { type: "string" },
    actual_result: { type: "string" },
    failure_reason: { type: "string" },
  },
} as const;

export class LlmProtocolError extends Error {
  constructor(message = "LLM returned an invalid response") {
    super(message);
    this.name = "LlmProtocolError";
  }
}

export class LlmUnavailableError extends Error {
  constructor(message = "LLM provider unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmUnavailableError";
  }
}

class RetryableLlmError extends Error {}

type LlmConfig = Pick<AppConfig, "anthropicApiKey" | "llmModel">;
type Sleep = (milliseconds: number) => Promise<void>;

export interface AnthropicClientOptions {
  sleep?: Sleep;
  timeoutMs?: number;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResponse(value: unknown): {
  action: AgentAction;
  tokensUsed: number;
} {
  if (!isRecord(value) || !Array.isArray(value.content) || !isRecord(value.usage)) {
    throw new LlmProtocolError();
  }
  const toolUse = value.content.find(
    (block) =>
      isRecord(block) &&
      block.type === "tool_use" &&
      block.name === "browser_action",
  );
  if (!isRecord(toolUse)) throw new LlmProtocolError("LLM omitted browser_action");

  const parsedAction = agentActionSchema.safeParse(toolUse.input);
  const inputTokens = value.usage.input_tokens;
  const outputTokens = value.usage.output_tokens;
  if (
    !parsedAction.success ||
    typeof inputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0 ||
    !Number.isSafeInteger(inputTokens + outputTokens)
  ) {
    throw new LlmProtocolError();
  }
  return {
    action: parsedAction.data,
    tokensUsed: inputTokens + outputTokens,
  };
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly sleep: Sleep;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: LlmConfig,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    options: AnthropicClientOptions = {},
  ) {
    this.sleep = options.sleep ?? sleep;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async decideAction(input: {
    system: string;
    userText: string;
    screenshotJpegBase64: string | null;
  }): Promise<{ action: AgentAction; tokensUsed: number }> {
    let lastError: unknown = new Error("LLM request failed");
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await this.request(input);
      } catch (error) {
        if (!(error instanceof RetryableLlmError)) throw error;
        lastError = error.cause ?? error;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        await this.sleep(delay);
      }
    }
    throw new LlmUnavailableError("LLM provider unavailable after retries", {
      cause: lastError,
    });
  }

  private async request(input: {
    system: string;
    userText: string;
    screenshotJpegBase64: string | null;
  }): Promise<{ action: AgentAction; tokensUsed: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(MESSAGES_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.config.anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.llmModel,
          max_tokens: 2048,
          system: input.system,
          messages: [
            {
              role: "user",
              content: [
                ...(input.screenshotJpegBase64 === null
                  ? []
                  : [
                      {
                        type: "image",
                        source: {
                          type: "base64",
                          media_type: "image/jpeg",
                          data: input.screenshotJpegBase64,
                        },
                      },
                    ]),
                { type: "text", text: input.userText },
              ],
            },
          ],
          tools: [
            {
              name: "browser_action",
              description: "Perform one browser action or finish the test",
              input_schema: AGENT_ACTION_INPUT_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: "browser_action" },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (retryableStatus(response.status)) {
          throw new RetryableLlmError(`LLM request failed: ${response.status}`);
        }
        throw new LlmProtocolError(`LLM request rejected: ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (controller.signal.aborted) {
          throw new RetryableLlmError("LLM response timed out", { cause: error });
        }
        throw new LlmProtocolError();
      }
      return parseResponse(payload);
    } catch (error) {
      if (
        error instanceof RetryableLlmError ||
        error instanceof LlmProtocolError
      ) {
        throw error;
      }
      throw new RetryableLlmError("LLM network request failed", { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
