import { apiGet, apiPost, ensureFreshToken } from "../lib/api";
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

function keepSession<T extends AuthSession>(session: T): T {
  setToken(session.accessToken, session.expiresIn);
  return session;
}

/** Registration signs the new account in; it stays on the verification screen until the emailed link is used. */
export async function register(name: string, email: string, password: string): Promise<AuthSession> {
  return keepSession(await apiPost<AuthSession>("/api/auth/register", { email, name, password }));
}

export async function login(email: string, password: string): Promise<AuthSession> {
  return keepSession(await apiPost<AuthSession>("/api/auth/login", { email, password }));
}

export async function logout(): Promise<void> {
  try {
    await apiPost<void>("/api/auth/logout");
  } finally {
    clearToken();
  }
}

export async function refresh(): Promise<AuthSession> {
  const session = await ensureFreshToken();
  return session as AuthSession;
}

export async function me(): Promise<User> {
  const result = await apiGet<{ user: User }>("/api/auth/me");
  return result.user;
}

/** Using the emailed link proves control of the inbox, so it also signs this browser in. */
export async function verifyEmail(token: string): Promise<VerifiedSession> {
  return keepSession(await apiPost<VerifiedSession>("/api/auth/verify-email", { token }));
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
