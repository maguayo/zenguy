import type { AgentAction } from "../../domain/browser_tests/agent_types";
import {
  AGENT_ACTION_INPUT_SCHEMA,
  LlmProtocolError,
  LlmUnavailableError,
  OpenAiLlmClient,
} from "./openai";

const config = {
  openaiApiKey: "openai-secret",
  llmModel: "gpt-5-mini",
};

const finishAction: AgentAction = {
  thought: "The expected result is visible.",
  action: "finish",
  outcome: "PASSED",
  summary: "The test passed.",
  expected_result: "The cart contains one item.",
  actual_result: "The cart contains one item.",
};

function openAiResponse(
  action: unknown = finishAction,
  inputTokens = 120,
  outputTokens = 30,
): Response {
  return Response.json({
    id: "resp_test",
    output: [
      { type: "reasoning", id: "reasoning_test", summary: [] },
      {
        type: "function_call",
        id: "function_test",
        call_id: "call_test",
        name: "browser_action",
        arguments: JSON.stringify(action),
      },
    ],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
}

const noWait = {
  sleep: vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined),
};

describe("OpenAiLlmClient", () => {
  beforeEach(() => {
    noWait.sleep.mockClear();
  });

  it("sends the exact forced-function request with a low-detail JPEG and parses usage", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(openAiResponse());
    const client = new OpenAiLlmClient(config, fetchFn, noWait);

    await expect(
      client.decideAction({
        system: "System instructions",
        userText: "Current browser state",
        screenshotJpegBase64: "jpeg-base64",
      }),
    ).resolves.toEqual({ action: finishAction, tokensUsed: 150 });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      authorization: "Bearer openai-secret",
      "content-type": "application/json",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-5-mini",
      instructions: "System instructions",
      max_output_tokens: 2_048,
      store: false,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Current browser state" },
            {
              type: "input_image",
              image_url: "data:image/jpeg;base64,jpeg-base64",
              detail: "low",
            },
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
    });
  });

  it("omits the image block when vision input is absent", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(openAiResponse());
    const client = new OpenAiLlmClient(config, fetchFn, noWait);

    await client.decideAction({
      system: "system",
      userText: "text only",
      screenshotJpegBase64: null,
    });

    const [, init] = fetchFn.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      input: Array<{ content: unknown[] }>;
    };
    expect(body.input[0]?.content).toEqual([
      { type: "input_text", text: "text only" },
    ]);
  });

  it("invokes the Web API fetch function without a foreign receiver", async () => {
    const fetchFn = vi.fn(function (this: unknown) {
      if (this !== undefined) {
        return Promise.reject(new TypeError("Illegal invocation"));
      }
      return Promise.resolve(openAiResponse());
    }) as unknown as typeof fetch;
    const client = new OpenAiLlmClient(config, fetchFn, noWait);

    await expect(
      client.decideAction({
        system: "system",
        userText: "state",
        screenshotJpegBase64: null,
      }),
    ).resolves.toEqual({ action: finishAction, tokensUsed: 150 });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("retries retryable statuses with 1s and 4s backoff, then throws unavailable", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const client = new OpenAiLlmClient(config, fetchFn, noWait);

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
      .mockResolvedValueOnce(openAiResponse());
    const client = new OpenAiLlmClient(config, fetchFn, noWait);

    await expect(
      client.decideAction({
        system: "system",
        userText: "state",
        screenshotJpegBase64: null,
      }),
    ).resolves.toEqual({ action: finishAction, tokensUsed: 150 });
    expect(noWait.sleep.mock.calls).toEqual([[1_000], [4_000]]);
  });

  it("maps malformed function input to a protocol error without retrying", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(openAiResponse({ thought: "Click.", action: "click", index: "zero" }));
    const client = new OpenAiLlmClient(config, fetchFn, noWait);

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

  it("rejects missing functions, malformed arguments and usage, invalid JSON, and non-retryable HTTP errors", async () => {
    const malformedArguments = openAiResponse();
    const malformedPayload = (await malformedArguments.json()) as {
      output: Array<Record<string, unknown>>;
    };
    malformedPayload.output[1]!.arguments = "{";
    const cases = [
      Response.json({ output: [], usage: { input_tokens: 1, output_tokens: 1 } }),
      Response.json(malformedPayload),
      openAiResponse(finishAction, -1, 2),
      new Response("not JSON"),
      new Response(null, { status: 400 }),
    ];

    for (const response of cases) {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);
      const client = new OpenAiLlmClient(config, fetchFn, noWait);
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
    const client = new OpenAiLlmClient(config, fetchFn, {
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
