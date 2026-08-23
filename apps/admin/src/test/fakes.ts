import type { Bindings } from "../server/env";

export function fakeBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: {} as D1Database,
    ASSETS: {
      fetch: async () =>
        new Response("<html>spa</html>", {
          headers: { "content-type": "text/html" },
        }),
    } as unknown as Fetcher,
    ADMIN_EMAILS: "marcos@aguayo.es, Ops@Example.com",
    ADMIN_SESSION_SECRET: "admin-test-secret".padEnd(32, "-"),
    ZENGUY_API_ORIGIN: "https://api.zenguy.test",
    ...overrides,
  };
}
