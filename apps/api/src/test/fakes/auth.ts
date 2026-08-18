import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { RecordingEmailSender } from "./email";
import { FakeIds } from "./ids";
import { FakeEmailTokenRepo, FakeUserRepo } from "./repos";

export const TEST_NOW = 1_700_000_000_000;

export function authTestDependencies() {
  return {
    users: new FakeUserRepo(),
    emailTokens: new FakeEmailTokenRepo(),
    emailSender: new RecordingEmailSender(),
    clock: new FixedClock(TEST_NOW),
    ids: new FakeIds(),
    config: { appUrl: "https://app.zenguy.test" },
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
