import type {
  KeyEncryptionProvider,
  KeyWrapContext,
} from "../../shared/crypto";

const DATA_KEY_BYTES = 32;
const KEY_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const WRAPPED_KEY_MAX_LENGTH = 512;

export interface WrapDataKeyRequest {
  protocolVersion: 1;
  expectedKeyId: string;
  workspaceId: string;
  dataKeyId: string;
  wrapVersion: 1;
  plaintextDataKey: ArrayBuffer;
}

export interface WrappedDataKeyResponse {
  protocolVersion: 1;
  keyId: string;
  wrappedKey: string;
}

export interface UnwrapDataKeyRequest {
  protocolVersion: 1;
  keyId: string;
  workspaceId: string;
  dataKeyId: string;
  wrapVersion: 1;
  wrappedKey: string;
}

export interface UnwrappedDataKeyResponse {
  protocolVersion: 1;
  keyId: string;
  plaintextDataKey: ArrayBuffer;
}

/**
 * Narrow object-capability exposed by the private key-wrapping Worker. There is
 * deliberately no generic encrypt/decrypt primitive and no way to retrieve a
 * KEK. Cloudflare authenticates calls through the Service Binding itself.
 */
export interface KeyWrappingServiceBinding {
  wrapDataKey(request: WrapDataKeyRequest): Promise<WrappedDataKeyResponse>;
  unwrapDataKey(
    request: UnwrapDataKeyRequest,
  ): Promise<UnwrappedDataKeyResponse>;
}

function validateKeyId(keyId: string): void {
  if (!KEY_ID_REGEX.test(keyId)) {
    throw new Error("Invalid key-wrapping key id");
  }
}

function validateContext(
  context: Omit<KeyWrapContext, "wrappingKeyId">,
): void {
  if (
    context.workspaceId.length === 0 ||
    !/^dek-[A-Za-z0-9_-]{24}$/u.test(context.dataKeyId) ||
    context.wrapVersion !== 1
  ) {
    throw new Error("Invalid workspace data key wrapping context");
  }
}

function validateWrappedResponse(
  response: WrappedDataKeyResponse,
  expectedKeyId: string,
): void {
  if (
    response === null ||
    typeof response !== "object" ||
    response.protocolVersion !== 1 ||
    response.keyId !== expectedKeyId ||
    typeof response.wrappedKey !== "string" ||
    response.wrappedKey.length === 0 ||
    response.wrappedKey.length > WRAPPED_KEY_MAX_LENGTH ||
    !response.wrappedKey.startsWith(`w1:${expectedKeyId}:`)
  ) {
    throw new Error("Key-wrapping service returned an invalid response");
  }
}

/**
 * Production v4 provider. The API Worker handles plaintext DEKs transiently,
 * while all KEK operations happen behind a private Cloudflare Service Binding.
 */
export class CloudflareKeyWrappingProvider implements KeyEncryptionProvider {
  readonly activeKeyId: string;

  constructor(
    activeKeyId: string,
    private readonly service: KeyWrappingServiceBinding,
  ) {
    validateKeyId(activeKeyId);
    if (
      service === null ||
      typeof service !== "object" ||
      typeof service.wrapDataKey !== "function" ||
      typeof service.unwrapDataKey !== "function"
    ) {
      throw new Error("Missing key-wrapping Service Binding");
    }
    this.activeKeyId = activeKeyId;
  }

  async wrapKey(
    plaintextDataKey: Uint8Array,
    context: Omit<KeyWrapContext, "wrappingKeyId">,
  ): Promise<{ wrappingKeyId: string; wrappedKey: string }> {
    validateContext(context);
    if (plaintextDataKey.byteLength !== DATA_KEY_BYTES) {
      throw new Error("Workspace data key must be 32 bytes");
    }

    // RPC serializes its argument. Keep the caller-owned DEK separate so this
    // provider can clear its own transient copy immediately after the call.
    const copy = Uint8Array.from(plaintextDataKey);
    try {
      const response = await this.service.wrapDataKey({
        protocolVersion: 1,
        expectedKeyId: this.activeKeyId,
        workspaceId: context.workspaceId,
        dataKeyId: context.dataKeyId,
        wrapVersion: 1,
        plaintextDataKey: copy.buffer,
      });
      validateWrappedResponse(response, this.activeKeyId);
      return {
        wrappingKeyId: response.keyId,
        wrappedKey: response.wrappedKey,
      };
    } finally {
      copy.fill(0);
    }
  }

  async unwrapKey(
    wrappedKey: string,
    context: KeyWrapContext,
  ): Promise<Uint8Array> {
    validateContext(context);
    validateKeyId(context.wrappingKeyId);
    if (
      typeof wrappedKey !== "string" ||
      wrappedKey.length === 0 ||
      wrappedKey.length > WRAPPED_KEY_MAX_LENGTH ||
      !wrappedKey.startsWith(`w1:${context.wrappingKeyId}:`)
    ) {
      throw new Error("Invalid wrapped workspace data key format");
    }

    const response = await this.service.unwrapDataKey({
      protocolVersion: 1,
      keyId: context.wrappingKeyId,
      workspaceId: context.workspaceId,
      dataKeyId: context.dataKeyId,
      wrapVersion: 1,
      wrappedKey,
    });
    if (
      response === null ||
      typeof response !== "object" ||
      response.protocolVersion !== 1 ||
      response.keyId !== context.wrappingKeyId ||
      !(response.plaintextDataKey instanceof ArrayBuffer) ||
      response.plaintextDataKey.byteLength !== DATA_KEY_BYTES
    ) {
      throw new Error("Key-wrapping service returned an invalid response");
    }
    return new Uint8Array(response.plaintextDataKey);
  }
}
