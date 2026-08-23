import {
  agentActionSchema,
  type AgentAction,
  type LlmClient,
} from "../../domain/browser_tests/agent_types";
import {
  cancelResponseBody,
  readLimitedJsonResponse,
} from "../../shared/limited_response";

export type { LlmClient } from "../../domain/browser_tests/agent_types";

// DEVIATION: The user explicitly selected OpenAI instead of the originally
// specified Anthropic provider; the domain-level LLM contract is unchanged.
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [1_000, 4_000] as const;
const MAX_RESPONSE_BYTES = 256 * 1_024;

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

interface LlmConfig {
  openaiApiKey: string;
  llmModel: string;
}
type Sleep = (milliseconds: number) => Promise<void>;

export interface OpenAiClientOptions {
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
  if (!isRecord(value) || !Array.isArray(value.output) || !isRecord(value.usage)) {
    throw new LlmProtocolError();
  }
  const functionCall = value.output.find(
    (item) =>
      isRecord(item) &&
      item.type === "function_call" &&
      item.name === "browser_action",
  );
  if (!isRecord(functionCall) || typeof functionCall.arguments !== "string") {
    throw new LlmProtocolError("LLM omitted browser_action");
  }

  let actionInput: unknown;
  try {
    actionInput = JSON.parse(functionCall.arguments);
  } catch {
    throw new LlmProtocolError("LLM returned malformed browser_action JSON");
  }

  const parsedAction = agentActionSchema.safeParse(actionInput);
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

export class OpenAiLlmClient implements LlmClient {
  private readonly sleep: Sleep;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: LlmConfig,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    options: OpenAiClientOptions = {},
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
      // Call Web API functions without binding them to this client instance.
      // Workerd brand-checks some platform APIs and rejects a foreign receiver.
      const fetchFn = this.fetchFn;
      const response = await fetchFn(RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.openaiApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.llmModel,
          instructions: input.system,
          max_output_tokens: 2_048,
          store: false,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: input.userText },
                ...(input.screenshotJpegBase64 === null
                  ? []
                  : [
                      {
                        type: "input_image",
                        image_url: `data:image/jpeg;base64,${input.screenshotJpegBase64}`,
                        detail: "low",
                      },
                    ]),
              ],
            },
          ],
          tools: [
            {
              type: "function",
              name: "browser_action",
              description: "Perform one browser action or finish the test",
              parameters: AGENT_ACTION_INPUT_SCHEMA,
              strict: false,
            },
          ],
          tool_choice: { type: "function", name: "browser_action" },
          parallel_tool_calls: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        if (retryableStatus(response.status)) {
          throw new RetryableLlmError(`LLM request failed: ${response.status}`);
        }
        throw new LlmProtocolError(`LLM request rejected: ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await readLimitedJsonResponse(response, MAX_RESPONSE_BYTES);
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
