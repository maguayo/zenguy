import {
  apiGet,
  apiPost,
  beginTerminalLogout,
  clearSession,
  confirmTerminalLogout,
  ensureFreshToken,
  isTerminalLogoutPending,
  storeSession,
  supersedeSession,
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

export interface RegistrationPending {
  registrationPending: true;
  email: string;
}

export class SessionStorageError extends Error {
  constructor() {
    super("Couldn't store the session securely on this device.");
    this.name = "SessionStorageError";
  }
}

/** Keeps a freshly issued session (memory + Keychain); a Keychain failure leaves nothing behind. */
async function keepSession<T extends AuthSession>(session: T): Promise<T> {
  const epoch = supersedeSession();
  try {
    await storeSession(session, epoch);
    await confirmTerminalLogout();
  } catch {
    // Keychain unavailable (for example an unsigned build): never keep a
    // half-stored session around.
    await clearSession();
    throw new SessionStorageError();
  }
  return session;
}

/** Retries a logout that could not reach the server on a previous attempt. */
export async function retryPendingLogout(): Promise<void> {
  if (!(await isTerminalLogoutPending())) return;
  const refreshToken = await secureStorage.getItem(storageKeys.refreshToken);
  if (refreshToken !== null) {
    await apiPost<void>("/api/auth/logout", { refreshToken });
  }
  await clearSession();
}

async function prepareForNewSession(): Promise<void> {
  if (await isTerminalLogoutPending()) await retryPendingLogout();
}

/** Atomically persists a session after the auth context tears down the old principal. */
export async function activateSession<T extends AuthSession>(session: T): Promise<T> {
  return keepSession(session);
}

/** Returns a new session for AuthContext to adopt after tearing down any prior principal. */
/** Registration is deliberately token-free until inbox + password verification. */
export function register(
  name: string,
  email: string,
  password: string,
): Promise<RegistrationPending> {
  return apiPost<RegistrationPending>("/api/auth/register", {
    email,
    name,
    password,
  });
}

export async function login(email: string, password: string): Promise<AuthSession> {
  await prepareForNewSession();
  return apiPost<AuthSession>("/api/auth/login", { email, password });
}

/**
 * Revokes the refresh token server-side, then forgets it locally even when
 * the network call fails: a lost device must never keep a usable session.
 */
export async function logout(): Promise<void> {
  const refreshToken = await secureStorage.getItem(storageKeys.refreshToken);
  await beginTerminalLogout();
  if (refreshToken === null) {
    await clearSession();
    return;
  }
  await apiPost<void>("/api/auth/logout", { refreshToken });
  await clearSession();
}

export async function refresh(): Promise<AuthSession> {
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
  // Do not overwrite the current principal before AuthContext has cleared its
  // cache and unregistered push with the old session.
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
