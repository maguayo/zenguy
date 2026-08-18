import { sha256Hex } from "../../shared/crypto";
import { authTestDependencies } from "../../test/fakes/auth";
import { Logout } from "./logout";

describe("Logout", () => {
  it("revokes a known refresh token", async () => {
    const dependencies = authTestDependencies();
    await dependencies.refreshTokens.insert({
      id: "rt_known",
      userId: "usr_alice",
      tokenHash: await sha256Hex("known-plain"),
      expiresAt: dependencies.clock.now() + 1_000,
      revokedAt: null,
      replacedById: null,
      createdAt: dependencies.clock.now(),
    });

    await expect(
      new Logout(dependencies).execute({
        refreshTokenPlain: "known-plain",
      }),
    ).resolves.toEqual({ loggedOut: true });
    expect(dependencies.refreshTokens.tokens.get("rt_known")?.revokedAt).toBe(
      dependencies.clock.now(),
    );
  });

  it("always succeeds for missing or unknown tokens", async () => {
    const dependencies = authTestDependencies();
    const useCase = new Logout(dependencies);

    await expect(
      useCase.execute({ refreshTokenPlain: null }),
    ).resolves.toEqual({ loggedOut: true });
    await expect(
      useCase.execute({ refreshTokenPlain: "unknown" }),
    ).resolves.toEqual({ loggedOut: true });
  });
});
