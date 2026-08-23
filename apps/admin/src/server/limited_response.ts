const CONTENT_LENGTH_PATTERN = /^(?:0|[1-9]\d*)$/u;

function assertLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
}

function declaredLengthExceedsLimit(value: string, maxBytes: number): boolean {
  const limit = String(maxBytes);
  return value.length > limit.length ||
    (value.length === limit.length && value > limit);
}

export async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** Reads the production API response without trusting Content-Length. */
export async function readLimitedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  assertLimit(maxBytes);
  const contentLength = response.headers.get("content-length")?.trim();
  if (
    contentLength !== undefined &&
    CONTENT_LENGTH_PATTERN.test(contentLength) &&
    declaredLengthExceedsLimit(contentLength, maxBytes)
  ) {
    await cancelResponseBody(response);
    throw new Error("Upstream response body too large");
  }

  if (response.body === null) throw new SyntaxError("Empty JSON response");
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
        throw new Error("Upstream response body too large");
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
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
}
