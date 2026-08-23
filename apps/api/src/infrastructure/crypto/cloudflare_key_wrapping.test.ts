import {
  CloudflareKeyWrappingProvider,
  type KeyWrappingServiceBinding,
  type UnwrapDataKeyRequest,
  type WrapDataKeyRequest,
} from "./cloudflare_key_wrapping";

const CONTEXT = {
  workspaceId: "ws_test",
  dataKeyId: "dek-AAAAAAAAAAAAAAAAAAAAAAAA",
  wrapVersion: 1 as const,
};

class FakeKeyWrappingService implements KeyWrappingServiceBinding {
  wrapRequest: WrapDataKeyRequest | null = null;
  unwrapRequest: UnwrapDataKeyRequest | null = null;
  plaintextAtCall: Uint8Array | null = null;

  async wrapDataKey(request: WrapDataKeyRequest) {
    this.wrapRequest = request;
    this.plaintextAtCall = Uint8Array.from(
      new Uint8Array(request.plaintextDataKey),
    );
    return {
      protocolVersion: 1 as const,
      keyId: request.expectedKeyId,
      wrappedKey: `w1:${request.expectedKeyId}:AAAAAAAAAAAAAAAA:BBBB`,
    };
  }

  async unwrapDataKey(request: UnwrapDataKeyRequest) {
    this.unwrapRequest = request;
    return {
      protocolVersion: 1 as const,
      keyId: request.keyId,
      plaintextDataKey: new Uint8Array(32).fill(7).buffer,
    };
  }
}

describe("CloudflareKeyWrappingProvider", () => {
  it("uses only the narrow Service Binding and clears its transient RPC copy", async () => {
    const service = new FakeKeyWrappingService();
    const provider = new CloudflareKeyWrappingProvider("primary", service);
    const plaintext = new Uint8Array(32).fill(7);

    await expect(provider.wrapKey(plaintext, CONTEXT)).resolves.toEqual({
      wrappingKeyId: "primary",
      wrappedKey: "w1:primary:AAAAAAAAAAAAAAAA:BBBB",
    });

    expect(service.plaintextAtCall).toEqual(plaintext);
    expect(new Uint8Array(service.wrapRequest!.plaintextDataKey)).toEqual(
      new Uint8Array(32),
    );
    expect(plaintext).toEqual(new Uint8Array(32).fill(7));
    expect(service.wrapRequest).toMatchObject({
      protocolVersion: 1,
      expectedKeyId: "primary",
      ...CONTEXT,
    });
  });

  it("passes the envelope key id for dual-read unwraps", async () => {
    const service = new FakeKeyWrappingService();
    const provider = new CloudflareKeyWrappingProvider("current", service);

    await expect(
      provider.unwrapKey("w1:previous:AAAAAAAAAAAAAAAA:BBBB", {
        ...CONTEXT,
        wrappingKeyId: "previous",
      }),
    ).resolves.toEqual(new Uint8Array(32).fill(7));
    expect(service.unwrapRequest).toEqual({
      protocolVersion: 1,
      keyId: "previous",
      ...CONTEXT,
      wrappedKey: "w1:previous:AAAAAAAAAAAAAAAA:BBBB",
    });
  });

  it("fails closed on a missing capability or mismatched service response", async () => {
    expect(
      () =>
        new CloudflareKeyWrappingProvider(
          "primary",
          {} as KeyWrappingServiceBinding,
        ),
    ).toThrow("Missing key-wrapping Service Binding");

    const service = new FakeKeyWrappingService();
    service.wrapDataKey = async () => ({
      protocolVersion: 1,
      keyId: "unexpected",
      wrappedKey: "w1:unexpected:AAAAAAAAAAAAAAAA:BBBB",
    });
    const provider = new CloudflareKeyWrappingProvider("primary", service);
    await expect(
      provider.wrapKey(new Uint8Array(32), CONTEXT),
    ).rejects.toThrow("invalid response");
  });

  it("rejects malformed key IDs, contexts and DEK lengths before RPC", async () => {
    const service = new FakeKeyWrappingService();
    expect(
      () => new CloudflareKeyWrappingProvider("bad:key", service),
    ).toThrow("Invalid key-wrapping key id");
    const provider = new CloudflareKeyWrappingProvider("primary", service);
    await expect(
      provider.wrapKey(new Uint8Array(31), CONTEXT),
    ).rejects.toThrow("32 bytes");
    await expect(
      provider.wrapKey(new Uint8Array(32), {
        ...CONTEXT,
        dataKeyId: "bad",
      }),
    ).rejects.toThrow("Invalid workspace data key wrapping context");
    expect(service.wrapRequest).toBeNull();
  });
});
