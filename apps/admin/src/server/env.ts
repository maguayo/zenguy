export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_EMAILS: string;
  ADMIN_SESSION_SECRET: string;
  ZENGUY_API_ORIGIN: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: { adminEmail: string };
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
