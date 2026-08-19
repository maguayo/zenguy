export type SseFrame =
  | { event: string; data: string }
  | { comment: string };

function encodeFrame(frame: SseFrame): Uint8Array {
  const encoder = new TextEncoder();
  if ("comment" in frame) {
    return encoder.encode(`: ${frame.comment}\n\n`);
  }
  const data = frame.data
    .split(/\r?\n/u)
    .map((line) => `data: ${line}`)
    .join("\n");
  return encoder.encode(`event: ${frame.event}\n${data}\n\n`);
}

export function sseResponse(generator: AsyncGenerator<SseFrame>): Response {
  const encoder = new TextEncoder();
  let sentRetry = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentRetry) {
        sentRetry = true;
        controller.enqueue(encoder.encode("retry: 3000\n\n"));
      }
      const next = await generator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encodeFrame(next.value));
    },
    async cancel() {
      await generator.return(undefined);
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
