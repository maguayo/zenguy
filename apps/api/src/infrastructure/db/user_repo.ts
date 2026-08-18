import type { UserRepo } from "../../domain/users/repo";
import type { User } from "../../domain/users/types";
import { one, run } from "./d1";

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  email_verified_at: number | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1UserRepo implements UserRepo {
  constructor(private readonly database: D1Database) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = await one<UserRow>(
      this.database
        .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
        .bind(email),
    );
    return row === null ? null : toUser(row);
  }

  async findById(id: string): Promise<User | null> {
    const row = await one<UserRow>(
      this.database.prepare("SELECT * FROM users WHERE id = ?").bind(id),
    );
    return row === null ? null : toUser(row);
  }

  async insert(user: User): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO users
            (id, name, email, password_hash, email_verified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          user.id,
          user.name,
          user.email,
          user.passwordHash,
          user.emailVerifiedAt,
          user.createdAt,
          user.updatedAt,
        ),
    );
  }

  async setEmailVerified(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          "UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?",
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
          "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
        )
        .bind(passwordHash, at, id),
    );
  }

  async updateName(id: string, name: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?")
        .bind(name, at, id),
    );
  }
}
