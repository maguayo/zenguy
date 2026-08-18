import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import type {
  EmailToken,
  RefreshToken,
  User,
} from "../../domain/users/types";

function clone<T extends object>(value: T): T {
  return { ...value };
}

export class FakeUserRepo implements UserRepo {
  readonly users = new Map<string, User>();

  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === normalized) return clone(user);
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    return user === undefined ? null : clone(user);
  }

  async insert(user: User): Promise<void> {
    if (
      this.users.has(user.id) ||
      (await this.findByEmail(user.email)) !== null
    ) {
      throw new Error("user constraint violation");
    }
    this.users.set(user.id, clone(user));
  }

  async setEmailVerified(id: string, at: number): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) {
      this.users.set(id, { ...user, emailVerifiedAt: at, updatedAt: at });
    }
  }

  async setPassword(
    id: string,
    passwordHash: string,
    at: number,
  ): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) {
      this.users.set(id, { ...user, passwordHash, updatedAt: at });
    }
  }

  async updateName(id: string, name: string, at: number): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) {
      this.users.set(id, { ...user, name, updatedAt: at });
    }
  }
}

export class FakeEmailTokenRepo implements EmailTokenRepo {
  readonly tokens = new Map<string, EmailToken>();

  async insert(token: EmailToken): Promise<void> {
    if (
      this.tokens.has(token.id) ||
      [...this.tokens.values()].some(
        (candidate) => candidate.tokenHash === token.tokenHash,
      )
    ) {
      throw new Error("email token constraint violation");
    }
    this.tokens.set(token.id, clone(token));
  }

  async findValidByHash(
    hash: string,
    type: EmailToken["type"],
    now: number,
  ): Promise<EmailToken | null> {
    for (const token of this.tokens.values()) {
      if (
        token.tokenHash === hash &&
        token.type === type &&
        token.usedAt === null &&
        token.expiresAt > now
      ) {
        return clone(token);
      }
    }
    return null;
  }

  async markUsed(id: string, at: number): Promise<void> {
    const token = this.tokens.get(id);
    if (token !== undefined) {
      this.tokens.set(id, { ...token, usedAt: at });
    }
  }

  async deleteAllForUser(
    userId: string,
    type: EmailToken["type"],
  ): Promise<void> {
    for (const [id, token] of this.tokens) {
      if (token.userId === userId && token.type === type) {
        this.tokens.delete(id);
      }
    }
  }
}

export class FakeRefreshTokenRepo implements RefreshTokenRepo {
  readonly tokens = new Map<string, RefreshToken>();

  async insert(token: RefreshToken): Promise<void> {
    if (
      this.tokens.has(token.id) ||
      [...this.tokens.values()].some(
        (candidate) => candidate.tokenHash === token.tokenHash,
      )
    ) {
      throw new Error("refresh token constraint violation");
    }
    this.tokens.set(token.id, clone(token));
  }

  async findByHash(hash: string): Promise<RefreshToken | null> {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === hash) return clone(token);
    }
    return null;
  }

  async revoke(
    id: string,
    at: number,
    replacedById?: string,
  ): Promise<void> {
    const token = this.tokens.get(id);
    if (token !== undefined) {
      this.tokens.set(id, {
        ...token,
        revokedAt: at,
        replacedById: replacedById ?? null,
      });
    }
  }

  async revokeAllForUser(userId: string, at: number): Promise<void> {
    for (const [id, token] of this.tokens) {
      if (token.userId === userId && token.revokedAt === null) {
        this.tokens.set(id, { ...token, revokedAt: at });
      }
    }
  }

  async deleteExpired(before: number): Promise<number> {
    let deleted = 0;
    for (const [id, token] of this.tokens) {
      if (token.expiresAt <= before) {
        this.tokens.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}
