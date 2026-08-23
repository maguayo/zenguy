import {
  decryptMonitorSensitive,
  encryptMonitorSensitive,
  readMonitorSensitive,
} from "./monitor_secrets";
import { createEncryptionKeyring } from "../../shared/crypto";

const KEY = new Uint8Array(32).fill(9);
const KEYS = createEncryptionKeyring({ id: "test-uptime", key: KEY });
const IDENTITY = { workspaceId: "ws_1", monitorId: "mon_1" };
const STORED_IDENTITY = { id: "mon_1", workspaceId: "ws_1" };

describe("uptime monitor sensitive configuration", () => {
  it("encrypts headers and body independently and decrypts only for privileged reads", async () => {
    const rawHeader = "Bearer raw-monitor-token";
    const rawBody = '{"password":"raw-body-secret"}';
    const encrypted = await encryptMonitorSensitive(
      {
        headers: [{ key: "Authorization", value: rawHeader }],
        body: rawBody,
      },
      KEYS,
      IDENTITY,
    );
    expect(encrypted.encryptedHeaders).toMatch(/^v4:dek-[A-Za-z0-9_-]{24}:/u);
    expect(encrypted.encryptedBody).toMatch(/^v4:dek-[A-Za-z0-9_-]{24}:/u);
    expect(JSON.stringify(encrypted)).not.toContain(rawHeader);
    expect(JSON.stringify(encrypted)).not.toContain("raw-body-secret");
    await expect(
      decryptMonitorSensitive({ ...STORED_IDENTITY, ...encrypted }, KEYS),
    ).resolves.toEqual({
      headers: [{ key: "Authorization", value: rawHeader }],
      body: rawBody,
    });
    await expect(
      readMonitorSensitive(
        { ...STORED_IDENTITY, ...encrypted },
        KEYS,
        true,
      ),
    ).resolves.toEqual({
      headers: [{ key: "Authorization", value: rawHeader }],
      body: rawBody,
      headersMasked: false,
    });
  });

  it("returns a masked member view without trying to decrypt ciphertext", async () => {
    await expect(
      readMonitorSensitive(
        {
          ...STORED_IDENTITY,
          encryptedHeaders: "not-valid-ciphertext",
          encryptedBody: "invalid",
        },
        KEYS,
        false,
      ),
    ).resolves.toEqual({ headers: null, body: null, headersMasked: true });
  });

  it("preserves absent values without creating ciphertext", async () => {
    await expect(
      encryptMonitorSensitive({}, KEYS, IDENTITY),
    ).resolves.toEqual({
      encryptedHeaders: null,
      encryptedBody: null,
    });
    await expect(
      readMonitorSensitive(
        { ...STORED_IDENTITY, encryptedHeaders: null, encryptedBody: null },
        KEYS,
        false,
      ),
    ).resolves.toEqual({ headers: null, body: null, headersMasked: true });
  });
});
