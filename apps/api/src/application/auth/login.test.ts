import { verifyAccessToken } from "../../infrastructure/auth/jwt";
import { REFRESH_TOKEN_TTL_DAYS } from "../../shared/constants";
import {
  hashPassword,
  passwordNeedsRehash,
  sha256Hex,
  verifyPassword,
} from "../../shared/crypto";
import { FakeTrackEvent } from "../../test/fakes/activity";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { DUMMY_PASSWORD_HASH, Login } from "./login";

async function legacyPasswordHash(
  password: string,
  iterations = 100_000,
): Promise<string> {
  const salt = new Uint8Array(16).fill(3);
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { hash: "SHA-256", iterations, name: "PBKDF2", salt },
      material,
      256,
    ),
  );
  const base64 = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes));
  return `pbkdf2$${iterations}$${base64(salt)}$${base64(derived)}`;
}

describe("Login", () => {
  it("creates a session for correct credentials, including unverified users", async () => {
    const dependencies = authTestDependencies();
    const user = testUser({
      passwordHash: await hashPassword("correct-password"),
      emailVerifiedAt: null,
      authVersion: 1,
    });
    await dependencies.users.insert(user);

    const result = await new Login(dependencies).execute({
      email: " ALICE@EXAMPLE.COM ",
      password: "correct-password",
      client: "web",
    });

    expect(result.user).toEqual(user);
    expect(result.expiresIn).toBe(1_800);
    await expect(
      verifyAccessToken(dependencies.config, result.accessToken),
    ).resolves.toMatchObject({ sub: user.id });
    const stored = await dependencies.refreshTokens.findByHash(
      await sha256Hex(result.refreshTokenPlain),
    );
    expect(stored).toMatchObject({
      userId: user.id,
      expiresAt:
        dependencies.clock.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1_000,
      revokedAt: null,
    });
  });

  it.each([
    { email: "alice@example.com", password: "wrong-password" },
    { email: "unknown@example.com", password: "correct-password" },
  ])("returns the same error for invalid credentials", async (input) => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(
      testUser({ passwordHash: await hashPassword("correct-password") }),
    );

    await expect(
      new Login(dependencies).execute({ ...input, client: "web" }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Incorrect email or password",
    });
  });

  it("keeps the unknown-account dummy record on the full current KDF", async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(
      /^pbkdf2-sha256\$v1\$100000\$[^$]+\$[^$]+$/u,
    );
    expect(passwordNeedsRehash(DUMMY_PASSWORD_HASH)).toBe(false);
    await expect(
      verifyPassword("any submitted password", DUMMY_PASSWORD_HASH),
    ).resolves.toBe(false);
  });

  it.each([100_000, 600_000])(
    "upgrades a valid legacy record with %i iterations after login",
    async (iterations) => {
      const dependencies = authTestDependencies();
      const user = testUser({
        passwordHash: await legacyPasswordHash("correct-password", iterations),
      });
      await dependencies.users.insert(user);

      await new Login(dependencies).execute({
        email: user.email,
        password: "correct-password",
        client: "web",
      });

      const updated = await dependencies.users.findById(user.id);
      expect(updated?.passwordHash).toMatch(
        /^pbkdf2-sha256\$v1\$100000\$/u,
      );
      await expect(
        verifyPassword("correct-password", updated?.passwordHash ?? ""),
      ).resolves.toBe(true);
    },
  );

  it("does not overwrite a concurrent password change while rehashing", async () => {
    const dependencies = authTestDependencies();
    const legacyHash = await legacyPasswordHash("correct-password");
    const concurrentHash = await hashPassword("concurrent replacement password");
    const user = testUser({ passwordHash: legacyHash });
    await dependencies.users.insert(user);
    const compareAndSwap = dependencies.users.rehashPasswordIfUnchanged.bind(
      dependencies.users,
    );
    const rehash = vi
      .spyOn(dependencies.users, "rehashPasswordIfUnchanged")
      .mockImplementation(async (id, expected, replacement, at) => {
        await dependencies.users.setPassword(id, concurrentHash, at);
        return compareAndSwap(id, expected, replacement, at);
      });

    await expect(
      new Login(dependencies).execute({
        email: user.email,
        password: "correct-password",
        client: "web",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(rehash).toHaveBeenCalledOnce();
    const updated = await dependencies.users.findById(user.id);
    await expect(
      verifyPassword(
        "concurrent replacement password",
        updated?.passwordHash ?? "",
      ),
    ).resolves.toBe(true);
    await expect(
      verifyPassword("correct-password", updated?.passwordHash ?? ""),
    ).resolves.toBe(false);
  });

  it("revokes a refresh inserted after a concurrent password reset", async () => {
    const dependencies = authTestDependencies();
    const user = testUser({
      passwordHash: await hashPassword("correct-password"),
      authVersion: 1,
    });
    await dependencies.users.insert(user);
    const replacementHash = await hashPassword("replacement-password");
    const insert = dependencies.refreshTokens.insert.bind(
      dependencies.refreshTokens,
    );
    vi.spyOn(dependencies.refreshTokens, "insert").mockImplementation(
      async (token) => {
        // This is the exploitable ordering: reset commits its revoke-all first,
        // then the stale login inserts a token that the reset did not see.
        await dependencies.sessionSecurity.resetPasswordAndRevokeAll(
          user.id,
          replacementHash,
          dependencies.clock.now(),
        );
        await insert(token);
      },
    );

    await expect(
      new Login(dependencies).execute({
        email: user.email,
        password: "correct-password",
        client: "web",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Incorrect email or password",
    });

    const tokens = [...dependencies.refreshTokens.tokens.values()];
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ userId: user.id });
    expect(tokens[0]?.revokedAt).not.toBeNull();
    const current = await dependencies.users.findById(user.id);
    expect(current?.authVersion).toBe(2);
    await expect(
      verifyPassword("replacement-password", current?.passwordHash ?? ""),
    ).resolves.toBe(true);
  });

  it("records user.logged_in with the client as source", async () => {
    const track = new FakeTrackEvent();
    const dependencies = { ...authTestDependencies(), track };
    const user = testUser({
      passwordHash: await hashPassword("correct horse battery"),
    });
    await dependencies.users.insert(user);
    const login = new Login(dependencies);

    await login.execute({
      email: user.email,
      password: "correct horse battery",
      client: "app",
    });

    expect(track.calls).toEqual([
      { type: "user.logged_in", userId: user.id, source: "app" },
    ]);
  });

  it("records nothing when credentials are wrong", async () => {
    const track = new FakeTrackEvent();
    const login = new Login({ ...authTestDependencies(), track });

    await expect(
      login.execute({
        email: "ghost@example.com",
        password: "wrong",
        client: "web",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(track.calls).toEqual([]);
  });
});
