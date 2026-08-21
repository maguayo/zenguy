import { clearToken, getToken, onExpiringSoon, setToken } from "./auth-token";
import { API_ORIGIN } from "./config";
import { secureStorage, storageKeys } from "./secure-storage";

// Identifies this app to /api/auth/*: the API then returns the refresh token
// in the JSON body (kept in the Keychain here) instead of a browser cookie.
const NATIVE_CLIENT_HEADER = "X-Zenguy-Client";
const NATIVE_CLIENT_VALUE = "native";

export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

/** Signed artifact URLs are relative to the API origin. */
export function absoluteArtifactUrl(url: string): string {
  return url.startsWith("/") ? apiUrl(url) : url;
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

export interface SessionTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export interface RefreshPayload extends SessionTokens {
  refreshExpiresIn: number;
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
  headers.set("Accept", "application/json, text/plain;q=0.9, */*;q=0.8");
  headers.set(NATIVE_CLIENT_HEADER, NATIVE_CLIENT_VALUE);
  if (includeJson) headers.set("Content-Type", "application/json");
  const token = getToken().accessToken;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/** Keeps the access token in memory and the refresh token in the Keychain. */
export async function storeSession(session: SessionTokens): Promise<void> {
  setToken(session.accessToken, session.expiresIn);
  await secureStorage.setItem(storageKeys.refreshToken, session.refreshToken);
}

/** Forgets the session locally (memory + Keychain). */
export async function clearSession(): Promise<void> {
  clearToken();
  await secureStorage.deleteItem(storageKeys.refreshToken);
}

export async function hasStoredSession(): Promise<boolean> {
  return (await secureStorage.getItem(storageKeys.refreshToken)) !== null;
}

async function signOutAfterAuthFailure(): Promise<void> {
  await clearSession();
  emitSignedOut();
}

/** A definitive rejection of the refresh token, as opposed to a flaky network. */
export function isAuthRejection(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 400);
}

export async function ensureFreshToken(): Promise<RefreshPayload> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await secureStorage.getItem(storageKeys.refreshToken);
    if (refreshToken === null) {
      throw new ApiError("Not signed in", { code: "UNAUTHORIZED", status: 401 });
    }
    const response = await fetch(apiUrl("/api/auth/refresh"), {
      body: JSON.stringify({ refreshToken }),
      headers: requestHeaders(true),
      method: "POST",
    });
    if (!response.ok) throw await parseApiError(response);
    const envelope = (await response.json()) as SuccessEnvelope<RefreshPayload>;
    await storeSession(envelope.data);
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
    // Only a rejected token ends the session. Being offline must not wipe the
    // Keychain and force the user to sign in again.
    if (isAuthRejection(error)) await signOutAfterAuthFailure();
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

async function send(
  method: string,
  path: string,
  body: unknown,
  options: RequestOptions,
  retried: boolean,
): Promise<Response> {
  if (!path.startsWith("/api/")) throw new Error("API paths must start with /api/");
  const response = await fetch(apiUrl(path), {
    body:
      body === undefined ? undefined : options.rawText ? String(body) : JSON.stringify(body),
    headers: requestHeaders(!options.rawText && body !== undefined),
    method,
  });

  const isAuthPath = path.startsWith("/api/auth/");
  if (response.status === 401 && !isAuthPath && !retried) {
    await refreshOrSignOut();
    return send(method, path, body, options, true);
  }

  if (!response.ok) {
    if (response.status === 401 && !isAuthPath && retried) await signOutAfterAuthFailure();
    throw await parseApiError(response);
  }
  return response;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(method, path, body, options, false);
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

export function filenameFromDisposition(value: string | null): string {
  if (!value) return "download";
  const utf8 = /filename\*=UTF-8''([^;]+)/iu.exec(value)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return utf8;
    }
  }
  return /filename="?([^";]+)"?/iu.exec(value)?.[1] ?? "download";
}

export interface TextDownload {
  filename: string;
  mimeType: string;
  text: string;
}

/** Text downloads (Markdown reports, YAML/JSON exports). */
export async function apiGetText(path: string): Promise<TextDownload> {
  const response = await send("GET", path, undefined, {}, false);
  return {
    filename: filenameFromDisposition(response.headers.get("Content-Disposition")),
    mimeType: response.headers.get("Content-Type")?.split(";")[0]?.trim() || "text/plain",
    text: await response.text(),
  };
}
