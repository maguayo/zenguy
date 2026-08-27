import type { User } from "../../domain/users/types";
import { WriteAudit } from "../../application/audit/write_audit";
import { FixedClock } from "../../shared/clock";
import { RecordingEmailSender } from "./email";
import { FakeIds } from "./ids";
import {
  FakeEmailTokenRepo,
  FakeAuditRepo,
  FakeLegalAcceptanceRepo,
  FakeMemberRepo,
  FakeRefreshTokenRepo,
  FakeSessionSecurityRepo,
  FakeUserRepo,
  FakeWorkspaceRepo,
  FakeWorkspaceState,
} from "./repos";

export const TEST_NOW = Date.now();

export function authTestDependencies() {
  const clock = new FixedClock(TEST_NOW);
  const ids = new FakeIds();
  const audits = new FakeAuditRepo();
  const workspaceState = new FakeWorkspaceState();
  const users = new FakeUserRepo();
  const legalAcceptances = new FakeLegalAcceptanceRepo();
  const refreshTokens = new FakeRefreshTokenRepo();
  return {
    users,
    legalAcceptances,
    emailTokens: new FakeEmailTokenRepo(),
    refreshTokens,
    sessionSecurity: new FakeSessionSecurityRepo(users, refreshTokens),
    workspaces: new FakeWorkspaceRepo(workspaceState),
    members: new FakeMemberRepo(workspaceState),
    audits,
    audit: new WriteAudit({ audits, clock, ids }),
    emailSender: new RecordingEmailSender(),
    clock,
    ids,
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
    authVersion: 1,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    ...overrides,
  };
}
