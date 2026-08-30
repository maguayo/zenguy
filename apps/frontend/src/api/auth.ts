import {
  ApiError,
  apiGet,
  apiPost,
  apiUrl,
  beginTerminalLogout,
  confirmTerminalLogout,
  ensureFreshToken,
  isTerminalLogoutPending,
  supersedeSession,
} from "../lib/api";
import { clearToken, setToken } from "../lib/auth-token";
import type { User } from "./types";

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface VerifiedSession extends AuthSession {
  verified: true;
}

export interface RegistrationPending {
  registrationPending: true;
  email: string;
}

const LOCAL_RETURN_ORIGIN = "https://app.zenguy.invalid";
const UNSAFE_ENCODED_RETURN_PATH =
  /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/iu;

function localAuthReturnPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(value) ||
    UNSAFE_ENCODED_RETURN_PATH.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, LOCAL_RETURN_ORIGIN);
    if (parsed.origin !== LOCAL_RETURN_ORIGIN) return null;
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (
      !normalized.startsWith("/") ||
      normalized.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/.test(normalized) ||
      UNSAFE_ENCODED_RETURN_PATH.test(normalized)
    ) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

/** Returns the first safe local continuation, falling back to the app root. */
export function authReturnPath(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const path = localAuthReturnPath(candidate);
    if (path !== null) return path;
  }
  return "/";
}

export function googleSignInUrl(next: unknown): string {
  const params = new URLSearchParams({ next: authReturnPath(next) });
  return apiUrl(`/api/auth/google/start?${params.toString()}`);
}

function keepSession<T extends AuthSession>(session: T): T {
  setToken(session.accessToken, session.expiresIn);
  return session;
}

/** Persists a session only after AuthContext has removed the previous principal's data. */
export function activateSession<T extends AuthSession>(session: T): T {
  supersedeSession();
  confirmTerminalLogout();
  return keepSession(session);
}

async function retryPendingLogout(): Promise<void> {
  if (!isTerminalLogoutPending()) return;
  await apiPost<void>("/api/auth/logout");
  confirmTerminalLogout();
}

async function prepareForNewSession(): Promise<void> {
  if (isTerminalLogoutPending()) await retryPendingLogout();
}

/** Clears any unfinished logout before handing the browser to Google. */
export async function prepareGoogleSignInUrl(next: unknown): Promise<string> {
  await prepareForNewSession();
  return googleSignInUrl(next);
}

export interface RegistrationConsent {
  acceptedPrivacy: boolean;
  acceptedTerms: boolean;
  marketingOptIn: boolean;
}

/** Registration is deliberately token-free until inbox + password verification. */
export function register(
  name: string,
  email: string,
  password: string,
  consent: RegistrationConsent,
): Promise<RegistrationPending> {
  return apiPost<RegistrationPending>("/api/auth/register", {
    acceptedPrivacy: consent.acceptedPrivacy,
    acceptedTerms: consent.acceptedTerms,
    email,
    marketingOptIn: consent.marketingOptIn,
    name,
    password,
  });
}

export async function login(email: string, password: string): Promise<AuthSession> {
  await prepareForNewSession();
  return apiPost<AuthSession>("/api/auth/login", { email, password });
}

export async function logout(): Promise<void> {
  beginTerminalLogout();
  try {
    await apiPost<void>("/api/auth/logout");
    confirmTerminalLogout();
  } finally {
    clearToken();
  }
}

export async function refresh(): Promise<AuthSession> {
  if (isTerminalLogoutPending()) {
    // Stay signed out even if the retry is offline; never turn the surviving
    // HttpOnly cookie back into a local session.
    await retryPendingLogout().catch(() => undefined);
    throw new ApiError("Signed out", { code: "UNAUTHORIZED", status: 401 });
  }
  const session = await ensureFreshToken();
  return session as AuthSession;
}

export async function me(): Promise<User> {
  const result = await apiGet<{ user: User }>("/api/auth/me");
  return result.user;
}

/** The inbox token and original registration password jointly verify the account. */
export async function verifyEmail(
  token: string,
  password: string,
): Promise<VerifiedSession> {
  await prepareForNewSession();
  return apiPost<VerifiedSession>("/api/auth/verify-email", { password, token });
}

export function resendVerification(email: string): Promise<{ sent: true }> {
  return apiPost("/api/auth/resend-verification", { email });
}

export function forgotPassword(email: string): Promise<{ sent: true }> {
  return apiPost("/api/auth/forgot-password", { email });
}

export function resetPassword(token: string, password: string): Promise<{ reset: true }> {
  return apiPost("/api/auth/reset-password", { password, token });
}
