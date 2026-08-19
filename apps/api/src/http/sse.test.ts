import { sseResponse, type SseFrame } from "./sse";

describe("sseResponse", () => {
  it("writes retry, event/data, multiline data, and comment frames", async () => {
    async function* frames(): AsyncGenerator<SseFrame> {
      yield { event: "update", data: "line one\nline two" };
      yield { comment: "ping" };
      yield { event: "done", data: "{}" };
    }

    const response = sseResponse(frames());
    expect(response.headers.get("Content-Type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    await expect(response.text()).resolves.toBe(
      "retry: 3000\n\n" +
        "event: update\n" +
        "data: line one\n" +
        "data: line two\n\n" +
        ": ping\n\n" +
        "event: done\n" +
        "data: {}\n\n",
    );
  });
});
