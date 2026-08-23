import type { Bindings } from "../server/env";
import type {
  AdminIdentity,
  AdminSessionStore,
  CreateAdminSessionInput,
} from "../server/admin_sessions";
import type { AccessVerifier } from "../server/access";

export const ADMIN_USER_ID = "usr_00000000000000000000000001";
export const ADMIN_EMAIL = "marcos@aguayo.es";
export const allowAdminAccess: AccessVerifier = {
  verify: async () => ({ email: ADMIN_EMAIL, subject: "access-admin-subject" }),
};

export class FakeAdminSessionStore implements AdminSessionStore {
  readonly identities = new Map<string, AdminIdentity>([
    [ADMIN_USER_ID, { userId: ADMIN_USER_ID, email: ADMIN_EMAIL, authVersion: 1 }],
  ]);
  readonly sessions = new Map<string, CreateAdminSessionInput & { revokedAt: number | null }>();

  async findEligibleIdentity(userId: string, email: string): Promise<AdminIdentity | null> {
    const found = this.identities.get(userId);
    return found !== undefined && found.email.toLowerCase() === email.toLowerCase() ? found : null;
  }

  async create(input: CreateAdminSessionInput): Promise<void> {
    this.sessions.set(input.idHash, { ...input, revokedAt: null });
  }

  async findActive(idHash: string, now: number): Promise<AdminIdentity | null> {
    const session = this.sessions.get(idHash);
    if (session === undefined || session.revokedAt !== null || session.expiresAt <= now) return null;
    const current = this.identities.get(session.userId);
    if (
      current === undefined ||
      current.authVersion !== session.authVersion ||
      current.email.toLowerCase() !== session.email.toLowerCase()
    ) {
      return null;
    }
    return current;
  }

  async revoke(idHash: string, now: number): Promise<void> {
    const session = this.sessions.get(idHash);
    if (session !== undefined && session.revokedAt === null) session.revokedAt = now;
  }
}

export function verifiedLoginBody(
  overrides: Partial<{ id: string; email: string; emailVerified: boolean }> = {},
) {
  return {
    data: {
      user: {
        id: ADMIN_USER_ID,
        email: ADMIN_EMAIL,
        emailVerified: true,
        ...overrides,
      },
      accessToken: "discarded",
    },
  };
}

export function fakeBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: {} as D1Database,
    ASSETS: {
      fetch: async () =>
        new Response("<html>spa</html>", {
          headers: { "content-type": "text/html" },
        }),
    } as unknown as Fetcher,
    ADMIN_USER_IDS: `${ADMIN_USER_ID},usr_00000000000000000000000002`,
    ZENGUY_API_ORIGIN: "https://api.zenguy.com",
    CF_ACCESS_TEAM_DOMAIN: "https://zenguy-test.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-access-audience-tag-000000000000",
    ...overrides,
  };
}
