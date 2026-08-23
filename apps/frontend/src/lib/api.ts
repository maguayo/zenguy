import { clearToken, getToken, onExpiringSoon, setToken } from "./auth-token";

// Deployed environments serve the API from its own origin (for example
// https://api.zenguy.com); an empty origin keeps same-origin relative URLs,
// which local development uses through the Vite proxy.
const API_ORIGIN = ((import.meta.env.VITE_API_ORIGIN as string | undefined) ?? "").replace(
  /\/+$/,
  "",
);
const LOGOUT_TOMBSTONE_KEY = "zenguy:logoutPending";

let sessionEpoch = 0;
let sessionController = new AbortController();
let logoutPendingInMemory = false;

/** A request completed after its principal was replaced or signed out. */
export class SessionSupersededError extends Error {
  constructor() {
    super("The authenticated session changed while the request was in flight");
    this.name = "SessionSupersededError";
  }
}

function throwIfSessionChanged(epoch: number): void {
  if (epoch !== sessionEpoch || sessionController.signal.aborted) {
    throw new SessionSupersededError();
  }
}

/** Abort and fence every operation that started under the previous principal. */
export function supersedeSession(): void {
  sessionEpoch += 1;
  sessionController.abort();
  sessionController = new AbortController();
  refreshInFlight = null;
  clearToken();
}

export function isTerminalLogoutPending(): boolean {
  if (logoutPendingInMemory) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOGOUT_TOMBSTONE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Prevent automatic cookie refresh until the server confirms revocation. */
export function beginTerminalLogout(): void {
  logoutPendingInMemory = true;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOGOUT_TOMBSTONE_KEY, "1");
    } catch {
      // The in-memory tombstone still protects the current page lifecycle.
    }
  }
  supersedeSession();
}

/** Called only after /logout has cleared the HttpOnly refresh cookie. */
export function confirmTerminalLogout(): void {
  logoutPendingInMemory = false;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(LOGOUT_TOMBSTONE_KEY);
    } catch {
      // The server-side cookie has already been revoked.
    }
  }
}

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

let refreshInFlight: { epoch: number; promise: Promise<RefreshPayload> } | null = null;

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
  supersedeSession();
  emitSignedOut();
}

export async function ensureFreshToken(): Promise<RefreshPayload> {
  if (isTerminalLogoutPending()) {
    throw new ApiError("Signed out", { code: "UNAUTHORIZED", status: 401 });
  }
  const epoch = sessionEpoch;
  if (refreshInFlight?.epoch === epoch) return refreshInFlight.promise;

  const promise = (async () => {
    const response = await fetch(apiUrl("/api/auth/refresh"), {
      credentials: "include",
      headers: requestHeaders(true),
      method: "POST",
      signal: sessionController.signal,
    });
    throwIfSessionChanged(epoch);
    if (!response.ok) throw await parseApiError(response);
    const envelope = (await response.json()) as SuccessEnvelope<RefreshPayload>;
    throwIfSessionChanged(epoch);
    setToken(envelope.data.accessToken, envelope.data.expiresIn);
    return envelope.data;
  })();
  refreshInFlight = { epoch, promise };

  try {
    return await promise;
  } finally {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  }
}

async function refreshOrSignOut(): Promise<void> {
  const epoch = sessionEpoch;
  try {
    await ensureFreshToken();
  } catch (error) {
    if (epoch === sessionEpoch && !(error instanceof SessionSupersededError)) {
      signOutAfterAuthFailure();
    }
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
  epoch = sessionEpoch,
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
    signal: sessionController.signal,
  });
  throwIfSessionChanged(epoch);

  const isAuthPath = path.startsWith("/api/auth/");
  if (response.status === 401 && !isAuthPath && !retried) {
    await refreshOrSignOut();
    throwIfSessionChanged(epoch);
    return request<T>(method, path, body, options, true, epoch);
  }

  if (!response.ok) {
    if (response.status === 401 && !isAuthPath && retried) signOutAfterAuthFailure();
    throw await parseApiError(response);
  }
  if (response.status === 204) return undefined as T;

  const envelope = (await response.json()) as SuccessEnvelope<unknown>;
  throwIfSessionChanged(epoch);
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

async function requestBlob(
  path: string,
  retried = false,
  epoch = sessionEpoch,
): Promise<{ blob: Blob; filename: string }> {
  if (!path.startsWith("/api/")) throw new Error("API paths must start with /api/");
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    headers: requestHeaders(false),
    method: "GET",
    signal: sessionController.signal,
  });
  throwIfSessionChanged(epoch);
  const isAuthPath = path.startsWith("/api/auth/");
  if (response.status === 401 && !isAuthPath && !retried) {
    await refreshOrSignOut();
    throwIfSessionChanged(epoch);
    return requestBlob(path, true, epoch);
  }
  if (!response.ok) {
    if (response.status === 401 && !isAuthPath && retried) signOutAfterAuthFailure();
    throw await parseApiError(response);
  }
  const blob = await response.blob();
  throwIfSessionChanged(epoch);
  return {
    blob,
    filename: filenameFromDisposition(response.headers.get("Content-Disposition")),
  };
}

export function apiGetBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  return requestBlob(path);
}
