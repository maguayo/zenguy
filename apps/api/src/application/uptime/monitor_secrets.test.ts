import {
  decryptMonitorSensitive,
  encryptMonitorSensitive,
  readMonitorSensitive,
} from "./monitor_secrets";

const KEY = new Uint8Array(32).fill(9);

describe("uptime monitor sensitive configuration", () => {
  it("encrypts headers and body independently and decrypts only for privileged reads", async () => {
    const rawHeader = "Bearer raw-monitor-token";
    const rawBody = '{"password":"raw-body-secret"}';
    const encrypted = await encryptMonitorSensitive(
      {
        headers: [{ key: "Authorization", value: rawHeader }],
        body: rawBody,
      },
      KEY,
    );
    expect(encrypted.encryptedHeaders).toMatch(/^v1:/u);
    expect(encrypted.encryptedBody).toMatch(/^v1:/u);
    expect(JSON.stringify(encrypted)).not.toContain(rawHeader);
    expect(JSON.stringify(encrypted)).not.toContain("raw-body-secret");
    await expect(decryptMonitorSensitive(encrypted, KEY)).resolves.toEqual({
      headers: [{ key: "Authorization", value: rawHeader }],
      body: rawBody,
    });
    await expect(readMonitorSensitive(encrypted, KEY, true)).resolves.toEqual({
      headers: [{ key: "Authorization", value: rawHeader }],
      body: rawBody,
      headersMasked: false,
    });
  });

  it("returns a masked member view without trying to decrypt ciphertext", async () => {
    await expect(
      readMonitorSensitive(
        { encryptedHeaders: "not-valid-ciphertext", encryptedBody: "invalid" },
        KEY,
        false,
      ),
    ).resolves.toEqual({ headers: null, body: null, headersMasked: true });
  });

  it("preserves absent values without creating ciphertext", async () => {
    await expect(encryptMonitorSensitive({}, KEY)).resolves.toEqual({
      encryptedHeaders: null,
      encryptedBody: null,
    });
    await expect(
      readMonitorSensitive(
        { encryptedHeaders: null, encryptedBody: null },
        KEY,
        false,
      ),
    ).resolves.toEqual({ headers: null, body: null, headersMasked: true });
  });
});
