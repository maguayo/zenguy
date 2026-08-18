import type { EmailToken, RefreshToken, User } from "./types";

export interface UserRepo {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  insert(user: User): Promise<void>;
  setEmailVerified(id: string, at: number): Promise<void>;
  setPassword(id: string, passwordHash: string, at: number): Promise<void>;
  updateName(id: string, name: string, at: number): Promise<void>;
}

export interface EmailTokenRepo {
  insert(token: EmailToken): Promise<void>;
  findValidByHash(
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
  revoke(id: string, at: number, replacedById?: string): Promise<void>;
  revokeAllForUser(userId: string, at: number): Promise<void>;
  deleteExpired(before: number): Promise<number>;
}
