import type {
  KeyWrappingServiceBinding,
  UnwrapDataKeyRequest,
  WrapDataKeyRequest,
} from "../../infrastructure/crypto/cloudflare_key_wrapping";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Synthetic RPC double. It is intentionally not production cryptography. */
export function fakeKeyWrappingService(): KeyWrappingServiceBinding {
  return {
    async wrapDataKey(request: WrapDataKeyRequest) {
      return {
        protocolVersion: 1,
        keyId: request.expectedKeyId,
        wrappedKey: `w1:${request.expectedKeyId}:AAAAAAAAAAAAAAAA:${bytesToBase64(
          new Uint8Array(request.plaintextDataKey),
        )}`,
      };
    },
    async unwrapDataKey(request: UnwrapDataKeyRequest) {
      const parts = request.wrappedKey.split(":");
      if (parts.length !== 4 || parts[1] !== request.keyId || parts[3] === undefined) {
        throw new Error("Invalid synthetic wrapped key");
      }
      const decoded = atob(parts[3]);
      return {
        protocolVersion: 1,
        keyId: request.keyId,
        plaintextDataKey: Uint8Array.from(
          decoded,
          (character) => character.charCodeAt(0),
        ).buffer,
      };
    },
  };
}
