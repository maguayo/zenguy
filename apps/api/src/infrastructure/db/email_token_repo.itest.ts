import type { EmailToken } from "../../domain/users/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1EmailTokenRepo } from "./email_token_repo";

const TOKEN: EmailToken = {
  id: "evt_verify",
  userId: "usr_alice",
  type: "VERIFY_EMAIL",
  tokenHash: "verify-hash",
  expiresAt: 2_000,
  usedAt: null,
  createdAt: 1_000,
};

describe("D1EmailTokenRepo", () => {
  let repo: D1EmailTokenRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1EmailTokenRepo(testEnv().DB);
  });

  it("inserts and finds an unused, unexpired token by hash and type", async () => {
    await repo.insert(TOKEN);

    await expect(
      repo.findValidByHash(TOKEN.tokenHash, TOKEN.type, 1_999),
    ).resolves.toEqual(TOKEN);
    await expect(
      repo.findValidByHash(TOKEN.tokenHash, "RESET_PASSWORD", 1_999),
    ).resolves.toBeNull();
  });

  it("does not find a used or expired token", async () => {
    await repo.insert(TOKEN);
    await expect(
      repo.findValidByHash(TOKEN.tokenHash, TOKEN.type, TOKEN.expiresAt),
    ).resolves.toBeNull();

    await repo.markUsed(TOKEN.id, 1_500);
    await expect(
      repo.findValidByHash(TOKEN.tokenHash, TOKEN.type, 1_499),
    ).resolves.toBeNull();
  });

  it("deletes all tokens for only the requested user and type", async () => {
    const resetToken: EmailToken = {
      ...TOKEN,
      id: "evt_reset",
      type: "RESET_PASSWORD",
      tokenHash: "reset-hash",
    };
    await repo.insert(TOKEN);
    await repo.insert(resetToken);

    await repo.deleteAllForUser(TOKEN.userId, "VERIFY_EMAIL");

    await expect(
      repo.findValidByHash(TOKEN.tokenHash, TOKEN.type, 1_100),
    ).resolves.toBeNull();
    await expect(
      repo.findValidByHash(resetToken.tokenHash, resetToken.type, 1_100),
    ).resolves.toEqual(resetToken);
  });
});
