import { clearToken, getToken, onExpiringSoon, setToken } from "./auth-token";

// Deployed environments serve the API from its own origin (for example
// https://api.zenguy.com); an empty origin keeps same-origin relative URLs,
// which local development uses through the Vite proxy.
const API_ORIGIN = ((import.meta.env.VITE_API_ORIGIN as string | undefined) ?? "").replace(
  /\/+$/,
  "",
);

function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details?: ApiErrorDetail[];
  readonly status: number;

  constructor(
    message: string,
    { code, details, status }: { code: string; details?: ApiErrorDetail[]; status: number },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

type SignedOutListener = () => void;
const signedOutListeners = new Set<SignedOutListener>();

function emitSignedOut() {
  for (const listener of signedOutListeners) listener();
}

export const authEvents = {
  onSignedOut(callback: SignedOutListener): () => void {
    signedOutListeners.add(callback);
    return () => signedOutListeners.delete(callback);
  },
};

interface ErrorEnvelope {
  error?: {
    code?: string;
    details?: ApiErrorDetail[];
    message?: string;
  };
}

interface SuccessEnvelope<T> {
  data: T;
  nextCursor?: string | null;
}

interface RefreshPayload {
  accessToken: string;
  expiresIn: number;
  user: unknown;
}

export interface ApiPage<T> {
  items: T[];
  nextCursor: string | null;
}

let refreshInFlight: Promise<RefreshPayload> | null = null;

async function parseApiError(response: Response): Promise<ApiError> {
  let envelope: ErrorEnvelope = {};
  try {
    envelope = (await response.json()) as ErrorEnvelope;
  } catch {
    // A non-JSON provider/proxy response still becomes a safe API error.
  }
  return new ApiError(envelope.error?.message ?? "Request failed", {
    code: envelope.error?.code ?? "INTERNAL",
    details: envelope.error?.details,
    status: response.status,
  });
}

function requestHeaders(includeJson: boolean): Headers {
  const headers = new Headers();
  if (includeJson) headers.set("Content-Type", "application/json");
  const token = getToken().accessToken;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function signOutAfterAuthFailure() {
  clearToken();
  emitSignedOut();
}

export async function ensureFreshToken(): Promise<RefreshPayload> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const response = await fetch(apiUrl("/api/auth/refresh"), {
      credentials: "include",
      headers: requestHeaders(true),
      method: "POST",
    });
    if (!response.ok) throw await parseApiError(response);
    const envelope = (await response.json()) as SuccessEnvelope<RefreshPayload>;
    setToken(envelope.data.accessToken, envelope.data.expiresIn);
    return envelope.data;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function refreshOrSignOut(): Promise<void> {
  try {
    await ensureFreshToken();
  } catch (error) {
    signOutAfterAuthFailure();
    throw error;
  }
}

onExpiringSoon(() => {
  void refreshOrSignOut().catch(() => undefined);
});

interface RequestOptions {
  page?: boolean;
  rawText?: boolean;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
  retried = false,
): Promise<T> {
  if (!path.startsWith("/api/")) throw new Error("API paths must start with /api/");
  const response = await fetch(apiUrl(path), {
    body:
      body === undefined
        ? undefined
        : options.rawText
          ? String(body)
          : JSON.stringify(body),
    credentials: "include",
    headers: requestHeaders(!options.rawText),
    method,
  });

  const isAuthPath = path.startsWith("/api/auth/");
  if (response.status === 401 && !isAuthPath && !retried) {
    await refreshOrSignOut();
    return request<T>(method, path, body, options, true);
  }

  if (!response.ok) {
    if (response.status === 401 && !isAuthPath && retried) signOutAfterAuthFailure();
    throw await parseApiError(response);
  }
  if (response.status === 204) return undefined as T;

  const envelope = (await response.json()) as SuccessEnvelope<unknown>;
  if (options.page) {
    return {
      items: envelope.data,
      nextCursor: envelope.nextCursor ?? null,
    } as T;
  }
  return envelope.data as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function apiGetPage<T>(path: string): Promise<ApiPage<T>> {
  return request<ApiPage<T>>("GET", path, undefined, { page: true });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

export function apiPostText<T>(path: string, text: string): Promise<T> {
  return request<T>("POST", path, text, { rawText: true });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PATCH", path, body);
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PUT", path, body);
}

export function apiDelete<T = void>(path: string, body?: unknown): Promise<T> {
  return request<T>("DELETE", path, body);
}

function filenameFromDisposition(value: string | null): string {
  if (!value) return "download";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return utf8;
    }
  }
  return /filename="?([^";]+)"?/i.exec(value)?.[1] ?? "download";
}

async function requestBlob(path: string, retried = false): Promise<{ blob: Blob; filename: string }> {
  if (!path.startsWith("/api/")) throw new Error("API paths must start with /api/");
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    headers: requestHeaders(false),
    method: "GET",
  });
  const isAuthPath = path.startsWith("/api/auth/");
  if (response.status === 401 && !isAuthPath && !retried) {
    await refreshOrSignOut();
    return requestBlob(path, true);
  }
  if (!response.ok) {
    if (response.status === 401 && !isAuthPath && retried) signOutAfterAuthFailure();
    throw await parseApiError(response);
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition")),
  };
}

export function apiGetBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  return requestBlob(path);
}
