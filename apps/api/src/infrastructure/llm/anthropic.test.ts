import type { AgentAction } from "../../domain/browser_tests/agent_types";
import {
  AGENT_ACTION_INPUT_SCHEMA,
  AnthropicLlmClient,
  LlmProtocolError,
  LlmUnavailableError,
} from "./anthropic";

const config = {
  anthropicApiKey: "anthropic-secret",
  llmModel: "claude-test-model",
};

const finishAction: AgentAction = {
  thought: "The expected result is visible.",
  action: "finish",
  outcome: "PASSED",
  summary: "The test passed.",
  expected_result: "The cart contains one item.",
  actual_result: "The cart contains one item.",
};

function anthropicResponse(
  action: unknown = finishAction,
  inputTokens = 120,
  outputTokens = 30,
): Response {
  return Response.json({
    id: "msg_test",
    content: [
      { type: "text", text: "ignored" },
      {
        type: "tool_use",
        id: "tool_test",
        name: "browser_action",
        input: action,
      },
    ],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
}

const noWait = {
  sleep: vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined),
};

describe("AnthropicLlmClient", () => {
  beforeEach(() => {
    noWait.sleep.mockClear();
  });

  it("sends the exact forced-tool request with a JPEG image and parses usage", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(anthropicResponse());
    const client = new AnthropicLlmClient(config, fetchFn, noWait);

    await expect(
      client.decideAction({
        system: "System instructions",
        userText: "Current browser state",
        screenshotJpegBase64: "jpeg-base64",
      }),
    ).resolves.toEqual({ action: finishAction, tokensUsed: 150 });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "x-api-key": "anthropic-secret",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "claude-test-model",
      max_tokens: 2048,
      system: "System instructions",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: "jpeg-base64",
              },
            },
            { type: "text", text: "Current browser state" },
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
    });
  });

  it("omits the image block when vision input is absent", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(anthropicResponse());
    const client = new AnthropicLlmClient(config, fetchFn, noWait);

    await client.decideAction({
      system: "system",
      userText: "text only",
      screenshotJpegBase64: null,
    });

    const [, init] = fetchFn.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ content: unknown[] }>;
    };
    expect(body.messages[0]?.content).toEqual([
      { type: "text", text: "text only" },
    ]);
  });

  it("retries retryable statuses with 1s and 4s backoff, then throws unavailable", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const client = new AnthropicLlmClient(config, fetchFn, noWait);

    await expect(
      client.decideAction({
        system: "system",
        userText: "state",
        screenshotJpegBase64: null,
      }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(noWait.sleep.mock.calls).toEqual([[1_000], [4_000]]);
  });

  it("can recover after a rate limit or network failure", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(anthropicResponse());
    const client = new AnthropicLlmClient(config, fetchFn, noWait);

    await expect(
      client.decideAction({
        system: "system",
        userText: "state",
        screenshotJpegBase64: null,
      }),
    ).resolves.toEqual({ action: finishAction, tokensUsed: 150 });
    expect(noWait.sleep.mock.calls).toEqual([[1_000], [4_000]]);
  });

  it("maps malformed tool input to a protocol error without retrying", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(anthropicResponse({ thought: "Click.", action: "click", index: "zero" }));
    const client = new AnthropicLlmClient(config, fetchFn, noWait);

    await expect(
      client.decideAction({
        system: "system",
        userText: "state",
        screenshotJpegBase64: null,
      }),
    ).rejects.toBeInstanceOf(LlmProtocolError);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(noWait.sleep).not.toHaveBeenCalled();
  });

  it("rejects missing tools, malformed usage, invalid JSON, and non-retryable HTTP errors", async () => {
    const cases = [
      Response.json({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
      anthropicResponse(finishAction, -1, 2),
      new Response("not JSON"),
      new Response(null, { status: 400 }),
    ];

    for (const response of cases) {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);
      const client = new AnthropicLlmClient(config, fetchFn, noWait);
      await expect(
        client.decideAction({
          system: "system",
          userText: "state",
          screenshotJpegBase64: null,
        }),
      ).rejects.toBeInstanceOf(LlmProtocolError);
      expect(fetchFn).toHaveBeenCalledOnce();
    }
  });

  it("aborts each request at the configured deadline and retries timeouts", async () => {
    const fetchFn = vi.fn<typeof fetch>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const client = new AnthropicLlmClient(config, fetchFn, {
      ...noWait,
      timeoutMs: 1,
    });

    await expect(
      client.decideAction({
        system: "system",
        userText: "state",
        screenshotJpegBase64: null,
      }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
