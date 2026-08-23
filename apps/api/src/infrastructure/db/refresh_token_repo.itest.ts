import type { RefreshToken } from "../../domain/users/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1RefreshTokenRepo } from "./refresh_token_repo";

const TOKEN: RefreshToken = {
  id: "rft_first",
  userId: "usr_alice",
  tokenHash: "refresh-hash",
  expiresAt: 2_000,
  revokedAt: null,
  replacedById: null,
  createdAt: 1_000,
};

describe("D1RefreshTokenRepo", () => {
  let repo: D1RefreshTokenRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1RefreshTokenRepo(testEnv().DB);
  });

  it("inserts and finds a refresh token by hash", async () => {
    await repo.insert(TOKEN);

    await expect(repo.findByHash(TOKEN.tokenHash)).resolves.toEqual(TOKEN);
    await expect(repo.findByHash("missing-hash")).resolves.toBeNull();
  });

  it("revokes one token and records its replacement", async () => {
    await repo.insert(TOKEN);

    await repo.revoke(TOKEN.id, 1_500, "rft_second");

    await expect(repo.findByHash(TOKEN.tokenHash)).resolves.toEqual({
      ...TOKEN,
      revokedAt: 1_500,
      replacedById: "rft_second",
    });
  });

  it("atomically creates only one child under concurrent rotation", async () => {
    await repo.insert(TOKEN);
    const replacements: RefreshToken[] = [
      { ...TOKEN, id: "rft_child_a", tokenHash: "child-a", createdAt: 1_500 },
      { ...TOKEN, id: "rft_child_b", tokenHash: "child-b", createdAt: 1_500 },
    ];

    const results = await Promise.all(
      replacements.map((replacement) => repo.rotate(TOKEN.id, replacement, 1_500)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const children = await Promise.all(
      replacements.map((replacement) => repo.findByHash(replacement.tokenHash)),
    );
    expect(children.filter((token) => token !== null)).toHaveLength(1);
    const parent = await repo.findByHash(TOKEN.tokenHash);
    expect(parent).toMatchObject({ revokedAt: 1_500 });
    expect(children.find((token) => token !== null)?.id).toBe(parent?.replacedById);
  });

  it("revokes every active token for a user", async () => {
    const second: RefreshToken = {
      ...TOKEN,
      id: "rft_second",
      tokenHash: "second-hash",
    };
    const otherUser: RefreshToken = {
      ...TOKEN,
      id: "rft_other",
      userId: "usr_bob",
      tokenHash: "other-hash",
    };
    await repo.insert(TOKEN);
    await repo.insert(second);
    await repo.insert(otherUser);

    await repo.revokeAllForUser(TOKEN.userId, 1_600);

    await expect(repo.findByHash(TOKEN.tokenHash)).resolves.toMatchObject({
      revokedAt: 1_600,
    });
    await expect(repo.findByHash(second.tokenHash)).resolves.toMatchObject({
      revokedAt: 1_600,
    });
    await expect(repo.findByHash(otherUser.tokenHash)).resolves.toEqual(
      otherUser,
    );
  });

  it("deletes expired tokens and returns the affected count", async () => {
    const active: RefreshToken = {
      ...TOKEN,
      id: "rft_active",
      tokenHash: "active-hash",
      expiresAt: 2_001,
    };
    await repo.insert(TOKEN);
    await repo.insert(active);

    await expect(repo.deleteExpired(2_000)).resolves.toBe(1);
    await expect(repo.findByHash(TOKEN.tokenHash)).resolves.toBeNull();
    await expect(repo.findByHash(active.tokenHash)).resolves.toEqual(active);
  });
});
