import type { UserRepo } from "../../domain/users/repo";
import type { User } from "../../domain/users/types";
import { all, one, run } from "./d1";

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  email_verified_at: number | null;
  auth_version: number;
  created_at: number;
  updated_at: number;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    authVersion: row.auth_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MAX_IDS_PER_QUERY = 90;

export class D1UserRepo implements UserRepo {
  constructor(private readonly database: D1Database) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = await one<UserRow>(
      this.database
        .prepare(
          "SELECT * FROM users WHERE email = ? COLLATE NOCASE AND deleted_at IS NULL",
        )
        .bind(email),
    );
    return row === null ? null : toUser(row);
  }

  async findById(id: string): Promise<User | null> {
    const row = await one<UserRow>(
      this.database
        .prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL")
        .bind(id),
    );
    return row === null ? null : toUser(row);
  }

  async findByIds(ids: string[]): Promise<User[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];
    const chunks = Array.from(
      { length: Math.ceil(uniqueIds.length / MAX_IDS_PER_QUERY) },
      (_, index) =>
        uniqueIds.slice(
          index * MAX_IDS_PER_QUERY,
          (index + 1) * MAX_IDS_PER_QUERY,
        ),
    );
    return (
      await Promise.all(
        chunks.map(async (chunk) => {
          const placeholders = chunk.map(() => "?").join(", ");
          return all<UserRow>(
            this.database
              .prepare(
                `SELECT * FROM users WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
              )
              .bind(...chunk),
          );
        }),
      )
    )
      .flat()
      .map(toUser);
  }

  async insert(user: User): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO users
            (id, name, email, password_hash, email_verified_at, auth_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          user.id,
          user.name,
          user.email,
          user.passwordHash,
          user.emailVerifiedAt,
          user.authVersion,
          user.createdAt,
          user.updatedAt,
        ),
    );
  }

  async insertIfAbsent(user: User): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `INSERT OR IGNORE INTO users
            (id, name, email, password_hash, email_verified_at, auth_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          user.id,
          user.name,
          user.email,
          user.passwordHash,
          user.emailVerifiedAt,
          user.authVersion,
          user.createdAt,
          user.updatedAt,
        ),
    );
    return result.meta.changes === 1;
  }

  async setEmailVerified(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE users SET email_verified_at = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(at, at, id),
    );
  }

  async setPassword(
    id: string,
    passwordHash: string,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE users SET password_hash = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(passwordHash, at, id),
    );
  }

  async rehashPasswordIfUnchanged(
    id: string,
    expectedPasswordHash: string,
    replacementPasswordHash: string,
    at: number,
  ): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE users
             SET password_hash = ?, updated_at = ?
           WHERE id = ? AND password_hash = ? AND deleted_at IS NULL`,
        )
        .bind(replacementPasswordHash, at, id, expectedPasswordHash),
    );
    return result.meta.changes === 1;
  }

  async updateName(id: string, name: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE users SET name = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(name, at, id),
    );
  }
}
