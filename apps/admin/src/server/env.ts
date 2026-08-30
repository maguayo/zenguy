interface WidenedConfigBindings {
  ZENGUY_API_ORIGIN: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  CLOUDFLARE_ACCOUNT_ID: string;
}

/**
 * Binding names and platform types come exclusively from `wrangler types`.
 * CF_ANALYTICS_API_TOKEN is deliberately optional: it is not in the required
 * secrets list, so a deploy never blocks on it and the costs collector simply
 * reports itself unconfigured until the token is installed.
 */
export type Bindings = Omit<
  Env,
  keyof WidenedConfigBindings
> &
  WidenedConfigBindings & { CF_ANALYTICS_API_TOKEN?: string };

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    adminEmail: string;
    adminUserId: string;
    accessEmail: string;
    accessSubject: string;
  };
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
