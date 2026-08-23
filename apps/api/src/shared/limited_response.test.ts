import { describe, expect, it, vi } from "vitest";
import {
  cancelResponseBody,
  externalProviderSignal,
  readLimitedJsonResponse,
  readLimitedResponseText,
  ResponseBodyTooLargeError,
} from "./limited_response";

describe("limited upstream responses", () => {
  it("accepts a body exactly at the byte limit", async () => {
    await expect(
      readLimitedResponseText(new Response("á"), 2),
    ).resolves.toBe("á");
  });

  it("rejects an oversized declared length before reading", async () => {
    const cancel = vi.fn(async () => undefined);
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(stream, {
      headers: { "content-length": "1000" },
    });

    await expect(readLimitedResponseText(response, 10)).rejects.toBeInstanceOf(
      ResponseBodyTooLargeError,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a very long numeric length without parsing an attacker-sized integer", async () => {
    const cancel = vi.fn(async () => undefined);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { "content-length": "9".repeat(8_192) },
    });

    await expect(readLimitedResponseText(response, 10)).rejects.toBeInstanceOf(
      ResponseBodyTooLargeError,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("counts a chunked body even when Content-Length is absent", async () => {
    const cancel = vi.fn(async () => undefined);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6));
        },
        cancel,
      }),
    );

    await expect(readLimitedResponseText(response, 5)).rejects.toBeInstanceOf(
      ResponseBodyTooLargeError,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not trust a smaller declared length", async () => {
    const response = new Response("123456", {
      headers: { "content-length": "2" },
    });
    await expect(readLimitedResponseText(response, 5)).rejects.toBeInstanceOf(
      ResponseBodyTooLargeError,
    );
  });

  it("parses bounded JSON and rejects malformed JSON", async () => {
    await expect(
      readLimitedJsonResponse(new Response('{"ok":true}'), 32),
    ).resolves.toEqual({ ok: true });
    await expect(
      readLimitedJsonResponse(new Response("not json"), 32),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it("rejects invalid UTF-8 instead of silently normalizing provider data", async () => {
    const response = new Response(
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    );
    await expect(readLimitedJsonResponse(response, 32)).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it("rejects invalid limits", async () => {
    await expect(
      readLimitedResponseText(new Response(""), -1),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("creates a finite provider deadline and rejects invalid deadlines", () => {
    expect(externalProviderSignal()).toBeInstanceOf(AbortSignal);
    expect(() => externalProviderSignal(0)).toThrow(RangeError);
  });

  it("cancels bodies that callers intentionally discard", async () => {
    const cancel = vi.fn(async () => undefined);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));

    await cancelResponseBody(response);

    expect(cancel).toHaveBeenCalledOnce();
  });
});
