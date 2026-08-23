import type { EmailToken, RefreshToken, User } from "./types";

export interface UserRepo {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findByIds(ids: string[]): Promise<User[]>;
  insert(user: User): Promise<void>;
  /** Constraint-backed account creation; false means email/id already exists. */
  insertIfAbsent(user: User): Promise<boolean>;
  setEmailVerified(id: string, at: number): Promise<void>;
  setPassword(id: string, passwordHash: string, at: number): Promise<void>;
  /** Rehashes only while the password verified by the caller is still live. */
  rehashPasswordIfUnchanged(
    id: string,
    expectedPasswordHash: string,
    replacementPasswordHash: string,
    at: number,
  ): Promise<boolean>;
  updateName(id: string, name: string, at: number): Promise<void>;
}

export interface EmailTokenRepo {
  insert(token: EmailToken): Promise<void>;
  findValidByHash(
    hash: string,
    type: EmailToken["type"],
    now: number,
  ): Promise<EmailToken | null>;
  /** Atomically claims a live token. Exactly one concurrent caller can win. */
  consumeValidByHash(
    hash: string,
    type: EmailToken["type"],
    now: number,
  ): Promise<EmailToken | null>;
  markUsed(id: string, at: number): Promise<void>;
  deleteAllForUser(userId: string, type: EmailToken["type"]): Promise<void>;
}

export interface RefreshTokenRepo {
  insert(token: RefreshToken): Promise<void>;
  findByHash(hash: string): Promise<RefreshToken | null>;
  /**
   * Atomically revokes `currentId` and inserts its replacement. Returns false
   * when another caller already claimed the parent or it has expired.
   */
  rotate(
    currentId: string,
    replacement: RefreshToken,
    at: number,
  ): Promise<boolean>;
  revoke(id: string, at: number, replacedById?: string): Promise<void>;
  revokeAllForUser(userId: string, at: number): Promise<void>;
  deleteExpired(before: number): Promise<number>;
}

export type SessionRevocationReason =
  | "logout"
  | "password_reset"
  | "refresh_reuse";

/** Security-sensitive multi-table operations that must commit atomically. */
export interface SessionSecurityRepo {
  revokeAllForUser(
    userId: string,
    at: number,
    reason: SessionRevocationReason,
  ): Promise<void>;
  resetPasswordAndRevokeAll(
    userId: string,
    passwordHash: string,
    at: number,
  ): Promise<void>;
}
