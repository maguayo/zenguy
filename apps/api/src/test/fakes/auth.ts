import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { RecordingEmailSender } from "./email";
import { FakeIds } from "./ids";
import {
  FakeEmailTokenRepo,
  FakeRefreshTokenRepo,
  FakeUserRepo,
} from "./repos";

export const TEST_NOW = Date.now();

export function authTestDependencies() {
  return {
    users: new FakeUserRepo(),
    emailTokens: new FakeEmailTokenRepo(),
    refreshTokens: new FakeRefreshTokenRepo(),
    emailSender: new RecordingEmailSender(),
    clock: new FixedClock(TEST_NOW),
    ids: new FakeIds(),
    config: {
      appUrl: "https://app.zenguy.test",
      jwtSecret: "jwt-test-secret".padEnd(32, "-"),
    },
  };
}

export function testUser(overrides: Partial<User> = {}): User {
  return {
    id: "usr_alice",
    name: "Alice",
    email: "alice@example.com",
    passwordHash: "password-hash",
    emailVerifiedAt: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    ...overrides,
  };
}
