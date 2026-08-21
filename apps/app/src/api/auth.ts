import {
  apiGet,
  apiPost,
  clearSession,
  ensureFreshToken,
  storeSession,
} from "../lib/api";
import { secureStorage, storageKeys } from "../lib/secure-storage";
import type { User } from "./types";

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  refreshToken: string;
  user: User;
}

export async function register(name: string, email: string, password: string): Promise<User> {
  const result = await apiPost<{ user: User }>("/api/auth/register", {
    email,
    name,
    password,
  });
  return result.user;
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const session = await apiPost<AuthSession>("/api/auth/login", { email, password });
  await storeSession(session);
  return session;
}

/**
 * Revokes the refresh token server-side, then forgets it locally even when
 * the network call fails: a lost device must never keep a usable session.
 */
export async function logout(): Promise<void> {
  const refreshToken = await secureStorage.getItem(storageKeys.refreshToken);
  try {
    if (refreshToken !== null) {
      await apiPost<void>("/api/auth/logout", { refreshToken });
    }
  } finally {
    await clearSession();
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

export function verifyEmail(token: string): Promise<{ verified: true }> {
  return apiPost("/api/auth/verify-email", { token });
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
