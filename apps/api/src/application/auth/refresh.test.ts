import type { RefreshToken } from "../../domain/users/types";
import { REFRESH_REUSE_GRACE_MS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { Refresh } from "./refresh";

async function insertRefresh(
  dependencies: ReturnType<typeof authTestDependencies>,
  plain: string,
  overrides: Partial<RefreshToken> = {},
): Promise<RefreshToken> {
  const token: RefreshToken = {
    id: "rt_original",
    userId: "usr_alice",
    tokenHash: await sha256Hex(plain),
    expiresAt: dependencies.clock.now() + 10_000,
    revokedAt: null,
    replacedById: null,
    createdAt: dependencies.clock.now(),
    ...overrides,
  };
  await dependencies.refreshTokens.insert(token);
  return token;
}

describe("Refresh", () => {
  it("rotates a valid token and links the revoked original", async () => {
    const dependencies = authTestDependencies();
    const user = testUser();
    await dependencies.users.insert(user);
    const original = await insertRefresh(dependencies, "original-plain");

    const result = await new Refresh(dependencies).execute({
      refreshTokenPlain: "original-plain",
    });

    expect(result.user).toEqual(user);
    expect(result.refreshTokenPlain).not.toBe("original-plain");
    const rotatedOriginal = dependencies.refreshTokens.tokens.get(original.id);
    expect(rotatedOriginal?.revokedAt).toBe(dependencies.clock.now());
    expect(rotatedOriginal?.replacedById).toBeTruthy();
    const replacement = await dependencies.refreshTokens.findByHash(
      await sha256Hex(result.refreshTokenPlain),
    );
    expect(replacement?.id).toBe(rotatedOriginal?.replacedById);
    expect(replacement?.revokedAt).toBeNull();
  });

  it("detects reuse after the grace window and revokes the whole token family", async () => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(testUser());
    await insertRefresh(dependencies, "original-plain");
    const useCase = new Refresh(dependencies);
    await useCase.execute({ refreshTokenPlain: "original-plain" });
    dependencies.clock.advance(REFRESH_REUSE_GRACE_MS + 1);

    await expect(
      useCase.execute({ refreshTokenPlain: "original-plain" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      [...dependencies.refreshTokens.tokens.values()].every(
        (token) => token.revokedAt !== null,
      ),
    ).toBe(true);
    await expect(dependencies.users.findById("usr_alice")).resolves.toMatchObject({
      authVersion: 2,
    });
    expect(dependencies.sessionSecurity.revokedAdminUsers).toContain("usr_alice");
    expect(dependencies.sessionSecurity.disabledPushUsers).toContain("usr_alice");
    await expect(
      useCase.execute({ refreshTokenPlain: "original-plain" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dependencies.sessionSecurity.revocations).toHaveLength(1);
  });

  it("moves a token rotated within the grace window to the head of its chain", async () => {
    // Two browser tabs share the refresh cookie: the second one presents the
    // token the first one just rotated. That is a race, not a stolen token.
    const dependencies = authTestDependencies();
    await dependencies.users.insert(testUser());
    const original = await insertRefresh(dependencies, "shared-cookie");
    const useCase = new Refresh(dependencies);
    const first = await useCase.execute({ refreshTokenPlain: "shared-cookie" });
    dependencies.clock.advance(REFRESH_REUSE_GRACE_MS - 1);

    const second = await useCase.execute({ refreshTokenPlain: "shared-cookie" });

    expect(second.refreshTokenPlain).not.toBe(first.refreshTokenPlain);
    expect(dependencies.sessionSecurity.revocations).toEqual([]);
    expect(dependencies.sessionSecurity.disabledPushUsers.size).toBe(0);
    const firstToken = await dependencies.refreshTokens.findByHash(
      await sha256Hex(first.refreshTokenPlain),
    );
    const secondToken = await dependencies.refreshTokens.findByHash(
      await sha256Hex(second.refreshTokenPlain),
    );
    // original → first → second: one live head, both ancestors linked.
    expect(dependencies.refreshTokens.tokens.get(original.id)?.replacedById).toBe(
      firstToken?.id,
    );
    expect(firstToken?.revokedAt).toBe(dependencies.clock.now());
    expect(firstToken?.replacedById).toBe(secondToken?.id);
    expect(secondToken?.revokedAt).toBeNull();
    expect(
      [...dependencies.refreshTokens.tokens.values()].filter(
        (token) => token.revokedAt === null,
      ),
    ).toHaveLength(1);
  });

  it("follows a chain that moved several steps within the grace window", async () => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(testUser());
    await insertRefresh(dependencies, "three-tabs");
    const useCase = new Refresh(dependencies);
    await useCase.execute({ refreshTokenPlain: "three-tabs" });
    await useCase.execute({ refreshTokenPlain: "three-tabs" });

    await expect(
      useCase.execute({ refreshTokenPlain: "three-tabs" }),
    ).resolves.toMatchObject({ user: expect.objectContaining({ id: "usr_alice" }) });
    expect(dependencies.sessionSecurity.revocations).toEqual([]);
    expect(
      [...dependencies.refreshTokens.tokens.values()].filter(
        (token) => token.revokedAt === null,
      ),
    ).toHaveLength(1);
  });

  it("does not extend grace to a token revoked without a successor", async () => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(testUser());
    await insertRefresh(dependencies, "logged-out", {
      revokedAt: dependencies.clock.now(),
    });

    await expect(
      new Refresh(dependencies).execute({ refreshTokenPlain: "logged-out" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dependencies.sessionSecurity.revocations).toEqual([
      expect.objectContaining({ userId: "usr_alice", reason: "refresh_reuse" }),
    ]);
  });

  it("lets the loser of a concurrent rotation continue from the winner's token", async () => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(testUser());
    await insertRefresh(dependencies, "racing-token");
    const useCase = new Refresh(dependencies);

    const results = await Promise.allSettled([
      useCase.execute({ refreshTokenPlain: "racing-token" }),
      useCase.execute({ refreshTokenPlain: "racing-token" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(dependencies.sessionSecurity.revocations).toEqual([]);
    expect(
      [...dependencies.refreshTokens.tokens.values()].filter(
        (token) => token.revokedAt === null,
      ),
    ).toHaveLength(1);
  });

  it("rejects an expired refresh token", async () => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(testUser());
    await insertRefresh(dependencies, "expired-plain", {
      expiresAt: dependencies.clock.now(),
    });

    await expect(
      new Refresh(dependencies).execute({
        refreshTokenPlain: "expired-plain",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a token that is unknown or belongs to a deleted user", async () => {
    const dependencies = authTestDependencies();
    const useCase = new Refresh(dependencies);
    await expect(
      useCase.execute({ refreshTokenPlain: "unknown" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await insertRefresh(dependencies, "orphaned");
    await expect(
      useCase.execute({ refreshTokenPlain: "orphaned" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
