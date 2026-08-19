import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  hmacSign,
  hmacSha256Hex,
  hmacVerify,
  hmacVerifyHex,
  randomToken,
  sha256Hex,
  timingSafeEqualBytes,
  verifyPassword,
} from "./crypto";

describe("password hashing", () => {
  it("round-trips the right password and rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(stored).toMatch(/^pbkdf2\$100000\$[^$]+\$[^$]+$/);
    await expect(
      verifyPassword("correct horse battery staple", stored),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong", stored)).resolves.toBe(false);
  });

  it("returns false for tampered or malformed formats", async () => {
    await expect(verifyPassword("password", "not-a-hash")).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword("password", "pbkdf2$abc$bad$bad"),
    ).resolves.toBe(false);
  });
});

describe("secret encryption", () => {
  const key = new Uint8Array(32).fill(7);

  it("round-trips plaintext", async () => {
    const encrypted = await encryptSecret("sensitive value 🔐", key);

    expect(encrypted).toMatch(/^v1:[^:]+:[^:]+$/);
    expect(encrypted).not.toContain("sensitive value");
    await expect(decryptSecret(encrypted, key)).resolves.toBe(
      "sensitive value 🔐",
    );
  });

  it("rejects tampered ciphertext", async () => {
    const encrypted = await encryptSecret("sensitive value", key);
    const [version, iv, ciphertext] = encrypted.split(":");
    if (version === undefined || iv === undefined || ciphertext === undefined) {
      throw new Error("Unexpected encryption test fixture");
    }
    const replacement = ciphertext.startsWith("A") ? "B" : "A";
    const tampered = `${version}:${iv}:${replacement}${ciphertext.slice(1)}`;

    await expect(decryptSecret(tampered, key)).rejects.toThrow();
  });

  it("rejects the wrong key", async () => {
    const encrypted = await encryptSecret("sensitive value", key);

    await expect(
      decryptSecret(encrypted, new Uint8Array(32).fill(8)),
    ).rejects.toThrow();
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
