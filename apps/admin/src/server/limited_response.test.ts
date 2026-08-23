import { describe, expect, it, vi } from "vitest";
import {
  cancelResponseBody,
  readLimitedJsonResponse,
} from "./limited_response";

describe("bounded upstream responses", () => {
  it("parses a bounded JSON body", async () => {
    await expect(
      readLimitedJsonResponse(Response.json({ ok: true }), 64),
    ).resolves.toEqual({ ok: true });
  });

  it("counts a chunked body and cancels it when the limit is exceeded", async () => {
    const cancel = vi.fn(async () => undefined);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(65));
        },
        cancel,
      }),
    );

    await expect(readLimitedJsonResponse(response, 64)).rejects.toThrow(
      "Upstream response body too large",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels a body that is deliberately discarded", async () => {
    const cancel = vi.fn(async () => undefined);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));

    await cancelResponseBody(response);

    expect(cancel).toHaveBeenCalledOnce();
  });
});
