import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

export interface StrictBodyLimitOptions {
  maxSize: number | ((context: Context<AppEnv>) => number);
  onError?: (context: Context<AppEnv>) => Response | Promise<Response>;
}

function declaredLength(request: Request): number | null {
  // A transfer-coded request has no trustworthy final byte count. Even for a
  // syntactically valid Content-Length we still count the stream below: this
  // header is only an early-rejection optimization, never the enforcement.
  if (request.headers.has("transfer-encoding")) return null;
  const raw = request.headers.get("content-length");
  if (raw === null || !/^\d+$/u.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function cancelQuietly(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (body === null) return;
  try {
    await body.cancel();
  } catch {
    // The response is already going to reject the request. Cancellation is a
    // best-effort resource release and must not replace the stable 413 body.
  }
}

/**
 * Buffers at most `maxSize` bytes before downstream parsers run.
 *
 * Unlike Hono's built-in middleware, enforcement never trusts a claimed
 * Content-Length: every accepted body is counted, and an oversized stream is
 * cancelled immediately instead of continuing to arrive in the isolate.
 */
export function strictBodyLimit(
  options: StrictBodyLimitOptions,
): MiddlewareHandler<AppEnv> {
  if (
    typeof options.maxSize !== "function" &&
    (!Number.isSafeInteger(options.maxSize) || options.maxSize < 0)
  ) {
    throw new TypeError("strictBodyLimit maxSize must be a non-negative integer");
  }
  const onError =
    options.onError ??
    ((context: Context<AppEnv>) => context.text("Payload Too Large", 413));

  return async (context, next) => {
    const maxSize =
      typeof options.maxSize === "function"
        ? options.maxSize(context)
        : options.maxSize;
    if (!Number.isSafeInteger(maxSize) || maxSize < 0) {
      throw new TypeError(
        "strictBodyLimit maxSize resolver must return a non-negative integer",
      );
    }
    const request = context.req.raw;
    const body = request.body;
    if (body === null) {
      await next();
      return;
    }

    const claimed = declaredLength(request);
    if (claimed !== null && claimed > maxSize) {
      await cancelQuietly(body);
      return onError(context);
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxSize) {
          try {
            await reader.cancel();
          } catch {
            // See cancelQuietly: keep the public failure deterministic.
          }
          return onError(context);
        }
        chunks.push(value);
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the original stream error.
      }
      throw error;
    }

    const replay = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    // Node's Request implementation used by unit tests requires `duplex`,
    // while the Workers runtime accepts the same standards-compatible init.
    const requestInit: RequestInit & { duplex: "half" } = {
      body: replay,
      duplex: "half",
    };
    context.req.raw = new Request(request, requestInit);
    await next();
  };
}
