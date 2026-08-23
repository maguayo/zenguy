import {
  KeyWrappingServiceCore,
  parseKeySetConfig,
  type KeyWrappingWorkerBindings,
} from "./key_wrapping_worker";

const CONTEXT = {
  protocolVersion: 1 as const,
  workspaceId: "ws_test",
  dataKeyId: "dek-AAAAAAAAAAAAAAAAAAAAAAAA",
  wrapVersion: 1 as const,
};

async function aesKey(
  byte: number,
  extractable = false,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(32).fill(byte),
    { name: "AES-GCM" },
    extractable,
    ["encrypt", "decrypt"],
  );
}

function keySet(
  activeKeyId: string,
  keys: Array<{ id: string; binding: string }>,
  writeKeyIds: string[] = [activeKeyId],
): string {
  return JSON.stringify({ configVersion: 1, activeKeyId, writeKeyIds, keys });
}

describe("private key-wrapping Worker", () => {
  it("wraps and unwraps with a non-exportable secret_key capability", async () => {
    const env: KeyWrappingWorkerBindings = {
      ENVIRONMENT: "production",
      KEY_WRAPPING_KEY_SET: keySet("primary", [
        { id: "primary", binding: "KMS_KEY_PRIMARY" },
      ]),
      KMS_KEY_PRIMARY: await aesKey(1),
    };
    const service = new KeyWrappingServiceCore(env);
    const original = new Uint8Array(32).fill(9);
    const rpcCopy = Uint8Array.from(original);

    const wrapped = await service.wrapDataKey({
      ...CONTEXT,
      expectedKeyId: "primary",
      plaintextDataKey: rpcCopy.buffer,
    });
    expect(wrapped).toMatchObject({ protocolVersion: 1, keyId: "primary" });
    expect(wrapped.wrappedKey).toMatch(/^w1:primary:[^:]+:[^:]+$/u);
    expect(rpcCopy).toEqual(new Uint8Array(32));

    const unwrapped = await service.unwrapDataKey({
      ...CONTEXT,
      keyId: "primary",
      wrappedKey: wrapped.wrappedKey,
    });
    expect(new Uint8Array(unwrapped.plaintextDataKey)).toEqual(original);
  });

  it("keeps previous IDs read-only during rotation", async () => {
    const previous = await aesKey(1);
    const current = await aesKey(2);
    const oldService = new KeyWrappingServiceCore({
      ENVIRONMENT: "production",
      KEY_WRAPPING_KEY_SET: keySet("old", [
        { id: "old", binding: "KMS_KEY_OLD" },
      ]),
      KMS_KEY_OLD: previous,
    });
    const oldWrapped = await oldService.wrapDataKey({
      ...CONTEXT,
      expectedKeyId: "old",
      plaintextDataKey: new Uint8Array(32).fill(5).buffer,
    });

    const rotated = new KeyWrappingServiceCore({
      ENVIRONMENT: "production",
      KEY_WRAPPING_KEY_SET: keySet(
        "current",
        [
          { id: "current", binding: "KMS_KEY_CURRENT" },
          { id: "old", binding: "KMS_KEY_OLD" },
        ],
        ["old", "current"],
      ),
      KMS_KEY_CURRENT: current,
      KMS_KEY_OLD: previous,
    });
    expect(rotated.describeKeySet()).toEqual({
      protocolVersion: 1,
      activeKeyId: "current",
      writeKeyIds: ["old", "current"],
      readKeyIds: ["current", "old"],
    });
    await expect(
      rotated.wrapDataKey({
        ...CONTEXT,
        expectedKeyId: "old",
        plaintextDataKey: new Uint8Array(32).buffer,
      }),
    ).resolves.toMatchObject({ keyId: "old" });
    const unwrapped = await rotated.unwrapDataKey({
      ...CONTEXT,
      keyId: "old",
      wrappedKey: oldWrapped.wrappedKey,
    });
    expect(new Uint8Array(unwrapped.plaintextDataKey)).toEqual(
      new Uint8Array(32).fill(5),
    );
  });

  it("binds key ID, workspace and DEK ID as authenticated context", async () => {
    const service = new KeyWrappingServiceCore({
      ENVIRONMENT: "staging",
      KEY_WRAPPING_KEY_SET: keySet("primary", [
        { id: "primary", binding: "KMS_KEY_PRIMARY" },
      ]),
      KMS_KEY_PRIMARY: await aesKey(3),
    });
    const wrapped = await service.wrapDataKey({
      ...CONTEXT,
      expectedKeyId: "primary",
      plaintextDataKey: new Uint8Array(32).fill(4).buffer,
    });

    await expect(
      service.wrapDataKey({
        ...CONTEXT,
        expectedKeyId: "unknown",
        plaintextDataKey: new Uint8Array(32).buffer,
      }),
    ).rejects.toThrow("not authorized");
    await expect(
      service.unwrapDataKey({
        ...CONTEXT,
        workspaceId: "ws_other",
        keyId: "primary",
        wrappedKey: wrapped.wrappedKey,
      }),
    ).rejects.toThrow("Unable to unwrap");
    await expect(
      service.unwrapDataKey({
        ...CONTEXT,
        dataKeyId: "dek-BBBBBBBBBBBBBBBBBBBBBBBB",
        keyId: "primary",
        wrappedKey: wrapped.wrappedKey,
      }),
    ).rejects.toThrow("Unable to unwrap");
  });

  it("rejects exportable, missing, mis-scoped and non-allowlisted keys", async () => {
    const keyConfig = keySet("primary", [
      { id: "primary", binding: "KMS_KEY_PRIMARY" },
    ]);
    expect(() =>
      new KeyWrappingServiceCore({
        ENVIRONMENT: "development",
        KEY_WRAPPING_KEY_SET: keyConfig,
        KMS_KEY_PRIMARY: awaitablePlaceholder,
      }).describeKeySet(),
    ).toThrow("restricted to named environments");

    expect(() =>
      new KeyWrappingServiceCore({
        ENVIRONMENT: "production",
        KEY_WRAPPING_KEY_SET: keyConfig,
      }).describeKeySet(),
    ).toThrow("Missing secret_key binding");

    const exportable = await aesKey(4, true);
    expect(() =>
      new KeyWrappingServiceCore({
        ENVIRONMENT: "production",
        KEY_WRAPPING_KEY_SET: keyConfig,
        KMS_KEY_PRIMARY: exportable,
      }).describeKeySet(),
    ).toThrow("Invalid non-exportable");

    const service = new KeyWrappingServiceCore({
      ENVIRONMENT: "production",
      KEY_WRAPPING_KEY_SET: keyConfig,
      KMS_KEY_PRIMARY: await aesKey(4),
    });
    await expect(
      service.unwrapDataKey({
        ...CONTEXT,
        keyId: "unknown",
        wrappedKey: "w1:unknown:AAAAAAAAAAAAAAAA:BBBB",
      }),
    ).rejects.toThrow("Unknown key-wrapping key id");
  });

  it("validates a bounded unique key-ID/binding allowlist", () => {
    expect(
      parseKeySetConfig(
        keySet("primary", [
          { id: "primary", binding: "KMS_KEY_PRIMARY" },
        ]),
      ),
    ).toEqual({
      configVersion: 1,
      activeKeyId: "primary",
      writeKeyIds: ["primary"],
      keys: [{ id: "primary", binding: "KMS_KEY_PRIMARY" }],
    });
    expect(() =>
      parseKeySetConfig(
        keySet("missing", [
          { id: "primary", binding: "KMS_KEY_PRIMARY" },
        ]),
      ),
    ).toThrow("not in the allowlist");
    expect(() =>
      parseKeySetConfig(
        keySet("same", [
          { id: "same", binding: "KMS_KEY_ONE" },
          { id: "same", binding: "KMS_KEY_TWO" },
        ]),
      ),
    ).toThrow("Invalid key-wrapping key-set");
  });
});

// The development-scope assertion fails before a binding is inspected.
const awaitablePlaceholder = {};
