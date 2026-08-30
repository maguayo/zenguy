import { Hono, type MiddlewareHandler } from "hono";
import type { GetPublicStatusPage } from "../../application/status_pages/get_public_status_page";
import type { PublicStatusPageView } from "../../application/status_pages/types";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { RateLimiter } from "../../shared/ratelimit";
import type { AppEnv } from "../env";
import {
  renderStatusPage,
  renderStatusPageNotFound,
} from "../views/status_page_html";

export type EdgeCache = Pick<Cache, "match" | "put">;

const CACHE_SECONDS = 60;
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";

function publicHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function htmlResponse(body: string, status: 200 | 404): Response {
  return new Response(body, {
    status,
    headers: publicHeaders("text/html; charset=utf-8"),
  });
}

function jsonResponse(body: unknown, status: 200 | 404): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...publicHeaders("application/json; charset=utf-8"),
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** Hostnames the anonymous custom-domain branch must never handle. */
export function isFirstPartyHost(host: string): boolean {
  const hostname = host.toLowerCase().replace(/:\d+$/u, "");
  return (
    hostname === "zenguy.com" ||
    hostname.endsWith(".zenguy.com") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname.endsWith(".workers.dev")
  );
}

interface ServeSharedDependencies {
  rateLimiter: RateLimiter;
  cache?: EdgeCache;
}

// Anonymous surface: no cookies, no sessions. Rate limiting only runs on
// cache misses so a cached page costs neither D1 reads nor limiter writes.
async function servePublic(
  dependencies: ServeSharedDependencies,
  request: { url: string; ip: string | undefined },
  format: "html" | "json",
  fetchView: () => Promise<PublicStatusPageView | null>,
  canonicalUrl: (view: PublicStatusPageView) => string,
): Promise<Response> {
  const cacheKey = new Request(new URL(request.url).toString());
  const cached = await dependencies.cache?.match(cacheKey);
  if (cached !== undefined) return cached;

  const address = request.ip ?? "unknown";
  const addressHash = await sha256Hex(address.slice(0, 128).toLowerCase());
  const result = await dependencies.rateLimiter.hit(
    `status:${addressHash}`,
    RATE_LIMITS.status_page.limit,
    RATE_LIMITS.status_page.windowSeconds,
  );
  if (!result.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests",
      undefined,
      result.retryAfterSeconds,
    );
  }

  const view = await fetchView();
  let response: Response;
  if (format === "json") {
    response =
      view === null
        ? jsonResponse(
            { error: { code: "NOT_FOUND", message: "Status page not found" } },
            404,
          )
        : jsonResponse({ data: view }, 200);
  } else {
    response =
      view === null
        ? htmlResponse(renderStatusPageNotFound(), 404)
        : htmlResponse(
            renderStatusPage(view, {
              canonicalUrl: canonicalUrl(view),
              preview: false,
            }),
            200,
          );
  }
  await dependencies.cache?.put(cacheKey, response.clone());
  return response;
}

export interface StatusPublicRoutesDependencies {
  getPublicStatusPage: GetPublicStatusPage;
  rateLimiter: RateLimiter;
  clock: Clock;
  config: Pick<AppConfig, "appUrl">;
  /** The edge cache; injectable so tests can observe hits and misses. */
  cache?: EdgeCache;
}

export function statusPublicRoutes(
  dependencies: StatusPublicRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const serve = (
    context: {
      req: {
        url: string;
        param(name: string): string;
        header(name: string): string | undefined;
      };
    },
    format: "html" | "json",
  ): Promise<Response> =>
    servePublic(
      dependencies,
      { url: context.req.url, ip: context.req.header("CF-Connecting-IP") },
      format,
      () => dependencies.getPublicStatusPage.bySlug(context.req.param("slug")),
      (view) => `${dependencies.config.appUrl}/status/${view.slug}`,
    );

  app.get("/:slug/json", (context) => serve(context, "json"));
  app.get("/:slug", (context) => serve(context, "html"));

  return app;
}

export interface CustomDomainGateDependencies {
  getPublicStatusPage: GetPublicStatusPage;
  rateLimiter: RateLimiter;
  cache?: EdgeCache;
}

/**
 * Serves verified customer domains (Cloudflare for SaaS traffic reaching the
 * zone-wide `*_/*` route) and blocks every other path under a foreign Host —
 * the API surface never responds under a customer's hostname.
 */
export function customDomainGate(
  dependencies: CustomDomainGateDependencies,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const url = new URL(context.req.url);
    if (isFirstPartyHost(url.host)) return next();

    const hostname = url.hostname.toLowerCase();
    const path = url.pathname;
    const method = context.req.method;
    if (method !== "GET" && method !== "HEAD") {
      return htmlResponse(renderStatusPageNotFound(), 404);
    }
    if (path !== "/" && path !== "/json") {
      return htmlResponse(renderStatusPageNotFound(), 404);
    }
    return servePublic(
      dependencies,
      { url: context.req.url, ip: context.req.header("CF-Connecting-IP") },
      path === "/json" ? "json" : "html",
      () => dependencies.getPublicStatusPage.byCustomDomain(hostname),
      () => `https://${hostname}/`,
    );
  };
}
