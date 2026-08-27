import {
  ApiError,
  apiGet,
  apiPost,
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
