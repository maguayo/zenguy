import { apiGet } from "../lib/api";

export interface AppRequirements {
  minVersion: string;
  storeUrl: string | null;
}

/** Public requirements for native builds (GET /api/app/version). */
export function getAppRequirements(): Promise<AppRequirements> {
  return apiGet("/api/app/version");
}
