interface WidenedConfigBindings {
  ZENGUY_API_ORIGIN: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
}

/** Binding names and platform types come exclusively from `wrangler types`. */
export type Bindings = Omit<
  Env,
  keyof WidenedConfigBindings
> &
  WidenedConfigBindings;

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
