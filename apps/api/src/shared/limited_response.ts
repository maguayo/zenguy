const CONTENT_LENGTH_PATTERN = /^(?:0|[1-9]\d*)$/u;

/** Wall-clock budget for non-streaming third-party API calls. */
export const EXTERNAL_PROVIDER_TIMEOUT_MS = 10_000;

export class ResponseBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Upstream response body exceeds ${maxBytes} bytes`);
    this.name = "ResponseBodyTooLargeError";
  }
}

function assertLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
}

function declaredLengthExceedsLimit(value: string, maxBytes: number): boolean {
  const limit = String(maxBytes);
  // Decimal length + lexicographic comparison avoids constructing an
  // attacker-sized BigInt from a provider-controlled header.
  return value.length > limit.length ||
    (value.length === limit.length && value > limit);
}

/**
 * The signal remains active after fetch resolves, so it also bounds a slow
 * response body rather than only the time-to-headers.
 */
export function externalProviderSignal(
  timeoutMs = EXTERNAL_PROVIDER_TIMEOUT_MS,
): AbortSignal {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive safe integer");
  }
  return AbortSignal.timeout(timeoutMs);
}

/** Releases the outgoing connection when a caller intentionally ignores a body. */
export async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * Reads an upstream body while enforcing the limit on the stream itself.
 * Content-Length is only an early rejection hint because it can be absent or
 * dishonest. Cancelling the reader also stops a provider from continuing to
 * feed a response that the Worker will reject.
 */
export async function readLimitedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  assertLimit(maxBytes);
  const contentLength = response.headers.get("content-length")?.trim();
  if (
    contentLength !== undefined &&
    CONTENT_LENGTH_PATTERN.test(contentLength) &&
    declaredLengthExceedsLimit(contentLength, maxBytes)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseBodyTooLargeError(maxBytes);
  }

  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function readLimitedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  return JSON.parse(await readLimitedResponseText(response, maxBytes)) as unknown;
}
