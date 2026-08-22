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

export interface VerifiedSession extends AuthSession {
  verified: true;
}

export class SessionStorageError extends Error {
  constructor() {
    super("Couldn't store the session securely on this device.");
    this.name = "SessionStorageError";
  }
}

/** Keeps a freshly issued session (memory + Keychain); a Keychain failure leaves nothing behind. */
async function keepSession<T extends AuthSession>(session: T): Promise<T> {
  try {
    await storeSession(session);
  } catch {
    // Keychain unavailable (for example an unsigned build): never keep a
    // half-stored session around.
    await clearSession();
    throw new SessionStorageError();
  }
  return session;
}

/** Registration signs the new account in; it stays on the verification screen until the emailed link is used. */
export async function register(name: string, email: string, password: string): Promise<AuthSession> {
  return keepSession(
    await apiPost<AuthSession>("/api/auth/register", { email, name, password }),
  );
}

export async function login(email: string, password: string): Promise<AuthSession> {
  return keepSession(await apiPost<AuthSession>("/api/auth/login", { email, password }));
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

/** Using the emailed link proves control of the inbox, so it also signs this device in. */
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
