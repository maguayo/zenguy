import {
  createEncryptionKeyring,
  decryptSecret,
  encryptedValueInfo,
  encryptSecret,
  encryptLegacySecretForMigration,
  encryptV2SecretForMigration,
  encryptV3SecretForMigration,
  getActiveWorkspaceDataKey,
  rotateWorkspaceDataKey,
  hashPassword,
  hmacSign,
  hmacSha256Hex,
  hmacVerify,
  hmacVerifyHex,
  passwordNeedsRehash,
  randomToken,
  sha256Hex,
  timingSafeEqualBytes,
  verifyPassword,
} from "./crypto";

describe("password hashing", () => {
  it("round-trips the right password and rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(stored).toMatch(
      /^pbkdf2-sha256\$v1\$100000\$[^$]+\$[^$]+$/,
    );
    await expect(
      verifyPassword("correct horse battery staple", stored),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong", stored)).resolves.toBe(false);
  });

  it("identifies legacy formats and work factors for rehash-on-login", () => {
    expect(
      passwordNeedsRehash(
        "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).toBe(true);
    expect(
      passwordNeedsRehash(
        "pbkdf2$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).toBe(true);
    expect(
      passwordNeedsRehash(
        "pbkdf2-sha256$v1$50000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).toBe(true);
    expect(
      passwordNeedsRehash(
        "pbkdf2-sha256$v1$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).toBe(false);
    expect(
      passwordNeedsRehash(
        "pbkdf2-sha256$v1$700000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).toBe(false);
    expect(passwordNeedsRehash("not-a-hash")).toBe(true);
  });

  it("uses NFC in the versioned format while preserving legacy byte semantics", async () => {
    const decomposed = "Cafe\u0301 has a long password";
    const composed = "Caf\u00e9 has a long password";
    const current = await hashPassword(decomposed);

    await expect(verifyPassword(composed, current)).resolves.toBe(true);
    await expect(verifyPassword(decomposed, current)).resolves.toBe(true);
  });

  it("returns false for tampered, malformed, or cost-amplifying formats", async () => {
    await expect(verifyPassword("password", "not-a-hash")).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword("password", "pbkdf2$abc$bad$bad"),
    ).resolves.toBe(false);
    await expect(
      verifyPassword(
        "password",
        "pbkdf2-sha256$v1$1200001$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).resolves.toBe(false);
    await expect(
      verifyPassword(
        "password",
        "pbkdf2-sha256$v1$6e5$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).resolves.toBe(false);
    await expect(
      verifyPassword(
        "password",
        "pbkdf2-sha256$v1$600000$AA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).resolves.toBe(false);
    await expect(
      verifyPassword(
        "password",
        "pbkdf2-sha256$v2$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).resolves.toBe(false);
  });
});

describe("secret encryption", () => {
  const key = new Uint8Array(32).fill(7);
  const previousKey = new Uint8Array(32).fill(6);
  const keys = createEncryptionKeyring(
    { id: "key-2026-08", key },
    [{ id: "key-2026-01", key: previousKey }],
  );
  const context = {
    type: "workspace_secret" as const,
    workspaceId: "ws_1",
    recordId: "sec_1",
  };

  it("round-trips v4 plaintext under a random persisted tenant DEK", async () => {
    const encrypted = await encryptSecret("sensitive value 🔐", keys, context);

    expect(encrypted).toMatch(/^v4:dek-[A-Za-z0-9_-]{24}:[^:]+:[^:]+$/);
    expect(encrypted).not.toContain("sensitive value");
    expect(encryptedValueInfo(encrypted)).toEqual({
      version: 4,
      keyId: encrypted.split(":")[1],
    });
    await expect(decryptSecret(encrypted, keys, context)).resolves.toBe(
      "sensitive value 🔐",
    );
  });

  it("authenticates type, workspace, record id, and key id as AAD", async () => {
    const encrypted = await encryptSecret("sensitive value", keys, context);

    await expect(
      decryptSecret(encrypted, keys, { ...context, recordId: "sec_2" }),
    ).rejects.toThrow();
    await expect(
      decryptSecret(encrypted, keys, { ...context, workspaceId: "ws_2" }),
    ).rejects.toThrow();
    await expect(
      decryptSecret(encrypted, keys, {
        ...context,
        type: "notification_channel",
      }),
    ).rejects.toThrow();

    const [version, keyId, iv, ciphertext] = encrypted.split(":");
    if (
      version === undefined ||
      keyId === undefined ||
      iv === undefined ||
      ciphertext === undefined
    ) {
      throw new Error("Unexpected encryption test fixture");
    }
    const otherWorkspace = await encryptSecret("other", keys, {
      ...context,
      workspaceId: "ws_2",
    });
    const otherDataKeyId = otherWorkspace.split(":")[1];
    if (otherDataKeyId === undefined) {
      throw new Error("Unexpected other-workspace encryption fixture");
    }
    const swappedKeyId = `${version}:${otherDataKeyId}:${iv}:${ciphertext}`;
    await expect(decryptSecret(swappedKeyId, keys, context)).rejects.toThrow();
  });

  it("rejects tampered ciphertext", async () => {
    const encrypted = await encryptSecret("sensitive value", keys, context);
    const [version, keyId, iv, ciphertext] = encrypted.split(":");
    if (
      version === undefined ||
      keyId === undefined ||
      iv === undefined ||
      ciphertext === undefined
    ) {
      throw new Error("Unexpected encryption test fixture");
    }
    const replacement = ciphertext.startsWith("A") ? "B" : "A";
    const tampered = `${version}:${keyId}:${iv}:${replacement}${ciphertext.slice(1)}`;

    await expect(decryptSecret(tampered, keys, context)).rejects.toThrow();
  });

  it("dual-reads v3 tenant-derived keys under previous roots", async () => {
    const oldOnly = createEncryptionKeyring({
      id: "key-2026-01",
      key: previousKey,
    });
    const encrypted = await encryptV3SecretForMigration(
      "old value",
      oldOnly,
      context,
    );

    await expect(decryptSecret(encrypted, keys, context)).resolves.toBe(
      "old value",
    );
    await expect(
      decryptSecret(
        encrypted,
        createEncryptionKeyring({ id: "key-2026-08", key }),
        context,
      ),
    ).rejects.toThrow("Unknown encryption key id");
  });

  it("uses one random DEK per workspace and keeps retired DEKs readable", async () => {
    const first = await encryptSecret("first", keys, context);
    const second = await encryptSecret("second", keys, {
      ...context,
      recordId: "sec_2",
    });
    expect(second.split(":")[1]).toBe(first.split(":")[1]);

    const active = await getActiveWorkspaceDataKey(keys, context.workspaceId);
    const rotated = await rotateWorkspaceDataKey(
      keys,
      context.workspaceId,
      active.id,
      1_800_000_000_000,
    );
    expect(rotated.id).not.toBe(active.id);
    expect(rotated.generation).toBe(active.generation + 1);

    const after = await encryptSecret("after", keys, {
      ...context,
      recordId: "sec_3",
    });
    expect(after.split(":")[1]).toBe(rotated.id);
    await expect(decryptSecret(first, keys, context)).resolves.toBe("first");
  });

  it("dual-reads v2 envelopes during the tenant-DEK migration", async () => {
    const oldOnly = createEncryptionKeyring({
      id: "key-2026-01",
      key: previousKey,
    });
    const encrypted = await encryptV2SecretForMigration(
      "old v2 value",
      oldOnly,
      context,
    );

    expect(encryptedValueInfo(encrypted)).toEqual({
      version: 2,
      keyId: "key-2026-01",
    });
    await expect(decryptSecret(encrypted, keys, context)).resolves.toBe(
      "old v2 value",
    );
  });

  it("dual-reads legacy v1 with the active or a previous key", async () => {
    const fromActive = await encryptLegacySecretForMigration("active", key);
    const fromPrevious = await encryptLegacySecretForMigration(
      "previous",
      previousKey,
    );

    expect(encryptedValueInfo(fromActive)).toEqual({ version: 1, keyId: null });
    await expect(decryptSecret(fromActive, keys, context)).resolves.toBe(
      "active",
    );
    await expect(decryptSecret(fromPrevious, keys, context)).resolves.toBe(
      "previous",
    );
  });

  it("validates bounded, unique key ids and 256-bit keys", () => {
    expect(() =>
      createEncryptionKeyring({ id: "bad:key", key }),
    ).toThrow("Encryption key id");
    expect(() =>
      createEncryptionKeyring(
        { id: "same", key },
        [{ id: "same", key: previousKey }],
      ),
    ).toThrow("Duplicate encryption key id");
    expect(() =>
      createEncryptionKeyring({ id: "short", key: new Uint8Array(31) }),
    ).toThrow("32 bytes");
  });
});

describe("signing and random values", () => {
  it("signs and verifies HMAC payloads", async () => {
    const signature = await hmacSign("secret", "payload");

    await expect(hmacVerify("secret", "payload", signature)).resolves.toBe(
      true,
    );
    await expect(hmacVerify("secret", "changed", signature)).resolves.toBe(
      false,
    );
    await expect(hmacVerify("other", "payload", signature)).resolves.toBe(
      false,
    );
  });

  it("signs and verifies provider-compatible hex HMACs", async () => {
    const signature = await hmacSha256Hex("secret", "payload");

    expect(signature).toBe(
      "b82fcb791acec57859b989b430a826488ce2e479fdf92326bd0a2e8375a42ba4",
    );
    await expect(
      hmacVerifyHex("secret", "payload", signature),
    ).resolves.toBe(true);
    await expect(
      hmacVerifyHex("secret", "changed", signature),
    ).resolves.toBe(false);
    await expect(hmacVerifyHex("secret", "payload", "not-hex")).resolves.toBe(
      false,
    );
  });

  it("creates unpadded base64url tokens with the requested entropy", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("computes SHA-256 hex", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("compares equal-length byte arrays without early exit", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(
      true,
    );
    expect(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(
      false,
    );
    expect(timingSafeEqualBytes(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(
      false,
    );
  });
});
