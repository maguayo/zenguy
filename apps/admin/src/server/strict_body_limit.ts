import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";

export interface StrictBodyLimitOptions {
  maxSize: number;
  onError: (context: Context<AppEnv>) => Response | Promise<Response>;
}

function declaredLength(request: Request): number | null {
  if (request.headers.has("transfer-encoding")) return null;
  const raw = request.headers.get("content-length");
  if (raw === null || !/^\d+$/u.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function cancelQuietly(body: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await body.cancel();
  } catch {
    // Cancellation is best effort; preserve the deterministic public 413.
  }
}

/** Counts every request stream instead of trusting a claimed Content-Length. */
export function strictBodyLimit(
  options: StrictBodyLimitOptions,
): MiddlewareHandler<AppEnv> {
  if (!Number.isSafeInteger(options.maxSize) || options.maxSize < 0) {
    throw new TypeError("strictBodyLimit maxSize must be a non-negative integer");
  }

  return async (context, next) => {
    const request = context.req.raw;
    const body = request.body;
    if (body === null) {
      await next();
      return;
    }
    const claimed = declaredLength(request);
    if (claimed !== null && claimed > options.maxSize) {
      await cancelQuietly(body);
      return options.onError(context);
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > options.maxSize) {
          try {
            await reader.cancel();
          } catch {
            // Preserve the stable 413 response.
          }
          return options.onError(context);
        }
        chunks.push(value);
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the original stream failure.
      }
      throw error;
    }

    const replay = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const requestInit: RequestInit & { duplex: "half" } = {
      body: replay,
      duplex: "half",
    };
    context.req.raw = new Request(request, requestInit);
    await next();
  };
}
