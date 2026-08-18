import type { RefreshToken } from "../../domain/users/types";
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

  it("detects reuse and revokes the whole token family", async () => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(testUser());
    await insertRefresh(dependencies, "original-plain");
    const useCase = new Refresh(dependencies);
    await useCase.execute({ refreshTokenPlain: "original-plain" });

    await expect(
      useCase.execute({ refreshTokenPlain: "original-plain" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      [...dependencies.refreshTokens.tokens.values()].every(
        (token) => token.revokedAt !== null,
      ),
    ).toBe(true);
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
