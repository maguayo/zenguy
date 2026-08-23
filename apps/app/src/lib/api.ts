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

let sessionEpoch = 0;
let sessionController = new AbortController();
let logoutPendingInMemory = false;
let refreshInFlight: { epoch: number; promise: Promise<RefreshPayload> } | null = null;

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
export function supersedeSession(): number {
  sessionEpoch += 1;
  sessionController.abort();
  sessionController = new AbortController();
  refreshInFlight = null;
  clearToken();
  return sessionEpoch;
}

export async function isTerminalLogoutPending(): Promise<boolean> {
  if (logoutPendingInMemory) return true;
  const stored = await secureStorage.getItem(storageKeys.logoutPending);
  if (stored === "1") logoutPendingInMemory = true;
  return stored === "1";
}

/** Fence refresh immediately, but retain its token so revocation can retry. */
export async function beginTerminalLogout(): Promise<void> {
  logoutPendingInMemory = true;
  supersedeSession();
  try {
    await secureStorage.setItem(storageKeys.logoutPending, "1");
  } catch {
    // The in-memory tombstone still protects this app lifecycle.
  }
}

export async function confirmTerminalLogout(): Promise<void> {
  logoutPendingInMemory = false;
  await secureStorage.deleteItem(storageKeys.logoutPending);
}

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
export async function storeSession(
  session: SessionTokens,
  expectedEpoch = sessionEpoch,
): Promise<void> {
  throwIfSessionChanged(expectedEpoch);
  await secureStorage.setItem(storageKeys.refreshToken, session.refreshToken);
  if (expectedEpoch !== sessionEpoch) {
    // Do not delete a newer principal's token if its write won the race.
    if ((await secureStorage.getItem(storageKeys.refreshToken)) === session.refreshToken) {
      await secureStorage.deleteItem(storageKeys.refreshToken);
    }
    throw new SessionSupersededError();
  }
  setToken(session.accessToken, session.expiresIn);
}

/** Forgets the session locally (memory + Keychain). */
export async function clearSession(): Promise<void> {
  supersedeSession();
  logoutPendingInMemory = false;
  await Promise.all([
    secureStorage.deleteItem(storageKeys.refreshToken),
    secureStorage.deleteItem(storageKeys.logoutPending),
  ]);
}

export async function hasStoredSession(): Promise<boolean> {
  if (await isTerminalLogoutPending()) return false;
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
  if (await isTerminalLogoutPending()) {
    throw new ApiError("Signed out", { code: "UNAUTHORIZED", status: 401 });
  }
  const epoch = sessionEpoch;
  if (refreshInFlight?.epoch === epoch) return refreshInFlight.promise;

  const promise = (async () => {
    const refreshToken = await secureStorage.getItem(storageKeys.refreshToken);
    throwIfSessionChanged(epoch);
    if (refreshToken === null) {
      throw new ApiError("Not signed in", { code: "UNAUTHORIZED", status: 401 });
    }
    const response = await fetch(apiUrl("/api/auth/refresh"), {
      body: JSON.stringify({ refreshToken }),
      headers: requestHeaders(true),
      method: "POST",
      signal: sessionController.signal,
    });
    throwIfSessionChanged(epoch);
    if (!response.ok) throw await parseApiError(response);
    const envelope = (await response.json()) as SuccessEnvelope<RefreshPayload>;
    throwIfSessionChanged(epoch);
    await storeSession(envelope.data, epoch);
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
    // Only a rejected token ends the session. Being offline must not wipe the
    // Keychain and force the user to sign in again.
    if (
      epoch === sessionEpoch &&
      !(error instanceof SessionSupersededError) &&
      isAuthRejection(error)
    ) {
      await signOutAfterAuthFailure();
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

async function send(
  method: string,
  path: string,
  body: unknown,
  options: RequestOptions,
  retried: boolean,
  epoch = sessionEpoch,
): Promise<Response> {
  if (!path.startsWith("/api/")) throw new Error("API paths must start with /api/");
  const response = await fetch(apiUrl(path), {
    body:
      body === undefined ? undefined : options.rawText ? String(body) : JSON.stringify(body),
    headers: requestHeaders(!options.rawText && body !== undefined),
    method,
    signal: sessionController.signal,
  });
  throwIfSessionChanged(epoch);

  const isAuthPath = path.startsWith("/api/auth/");
  if (response.status === 401 && !isAuthPath && !retried) {
    await refreshOrSignOut();
    throwIfSessionChanged(epoch);
    return send(method, path, body, options, true, epoch);
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
  const epoch = sessionEpoch;
  const response = await send(method, path, body, options, false, epoch);
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
  const epoch = sessionEpoch;
  const response = await send("GET", path, undefined, {}, false, epoch);
  const text = await response.text();
  throwIfSessionChanged(epoch);
  return {
    filename: filenameFromDisposition(response.headers.get("Content-Disposition")),
    mimeType: response.headers.get("Content-Type")?.split(";")[0]?.trim() || "text/plain",
    text,
  };
}
