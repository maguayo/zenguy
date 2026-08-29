import type {
  MetricRangeDays,
  Metrics,
  RecentRun,
  UserSummary,
  WorkersResponse,
} from "../shared/types";

/** A non-2xx answer from the admin API, carrying its `{ error: { code, message } }` body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** react-query key for the admin session: the gate reads it, login seeds it. */
export const SESSION_QUERY_KEY = ["me"] as const;

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    ...init,
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "UNKNOWN",
      payload?.error?.message ?? `HTTP ${response.status}`,
    );
  }
  return payload?.data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ email: string }>("/api/auth/login", {
      body: JSON.stringify({ email, password }),
      method: "POST",
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ email: string }>("/api/auth/me"),
  metrics: (days: MetricRangeDays) => request<Metrics>(`/api/metrics?days=${days}`),
  recentRuns: () => request<{ runs: RecentRun[] }>("/api/runs/recent?limit=50"),
  users: () => request<{ users: UserSummary[] }>("/api/users?limit=50"),
  workers: () => request<WorkersResponse>("/api/workers"),
};
