import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  KeyWrappingServiceBinding,
  UnwrapDataKeyRequest,
  UnwrappedDataKeyResponse,
  WrapDataKeyRequest,
  WrappedDataKeyResponse,
} from "./infrastructure/crypto/cloudflare_key_wrapping";

const encoder = new TextEncoder();
const DATA_KEY_BYTES = 32;
const KEY_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const DATA_KEY_ID_REGEX = /^dek-[A-Za-z0-9_-]{24}$/u;
const BINDING_NAME_REGEX = /^KMS_KEY_[A-Z0-9_]{1,64}$/u;
const WRAPPED_KEY_MAX_LENGTH = 512;

export interface KeyWrappingWorkerBindings {
  ENVIRONMENT: string;
  /** Non-secret allowlist: key IDs mapped to secret_key binding names. */
  KEY_WRAPPING_KEY_SET: string;
  [binding: string]: unknown;
}

interface KeyBindingConfig {
  id: string;
  binding: string;
}

interface KeySetConfig {
  configVersion: 1;
  activeKeyId: string;
  writeKeyIds: string[];
  keys: KeyBindingConfig[];
}

interface LoadedKeySet {
  activeKeyId: string;
  writeKeyIds: Set<string>;
  keys: Map<string, CryptoKey>;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
  ) {
    throw new Error("Invalid wrapped workspace data key encoding");
  }
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    throw new Error("Invalid wrapped workspace data key encoding");
  }
  const bytes = Uint8Array.from(
    decoded,
    (character) => character.charCodeAt(0),
  );
  if (bytesToBase64(bytes) !== encoded) {
    throw new Error("Invalid wrapped workspace data key encoding");
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseKeySetConfig(value: string): KeySetConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid key-wrapping key-set configuration");
  }
  if (
    !isRecord(parsed) ||
    parsed.configVersion !== 1 ||
    typeof parsed.activeKeyId !== "string" ||
    !KEY_ID_REGEX.test(parsed.activeKeyId) ||
    !Array.isArray(parsed.writeKeyIds) ||
    parsed.writeKeyIds.length === 0 ||
    parsed.writeKeyIds.length > 2 ||
    parsed.writeKeyIds.some(
      (keyId) => typeof keyId !== "string" || !KEY_ID_REGEX.test(keyId),
    ) ||
    new Set(parsed.writeKeyIds).size !== parsed.writeKeyIds.length ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length === 0 ||
    parsed.keys.length > 9
  ) {
    throw new Error("Invalid key-wrapping key-set configuration");
  }

  const ids = new Set<string>();
  const bindings = new Set<string>();
  const keys: KeyBindingConfig[] = [];
  for (const candidate of parsed.keys) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !KEY_ID_REGEX.test(candidate.id) ||
      typeof candidate.binding !== "string" ||
      !BINDING_NAME_REGEX.test(candidate.binding) ||
      ids.has(candidate.id) ||
      bindings.has(candidate.binding)
    ) {
      throw new Error("Invalid key-wrapping key-set configuration");
    }
    ids.add(candidate.id);
    bindings.add(candidate.binding);
    keys.push({ id: candidate.id, binding: candidate.binding });
  }
  if (
    !ids.has(parsed.activeKeyId) ||
    !parsed.writeKeyIds.includes(parsed.activeKeyId) ||
    parsed.writeKeyIds.some((keyId) => !ids.has(keyId))
  ) {
    throw new Error("Active key-wrapping key is not in the allowlist");
  }
  return {
    configVersion: 1,
    activeKeyId: parsed.activeKeyId,
    writeKeyIds: [...parsed.writeKeyIds],
    keys,
  };
}

function validateCryptoKey(value: unknown, binding: string): CryptoKey {
  if (!(value instanceof CryptoKey)) {
    throw new Error(`Missing secret_key binding: ${binding}`);
  }
  const algorithm = value.algorithm as KeyAlgorithm & { length?: number };
  const usages = new Set(value.usages);
  if (
    value.type !== "secret" ||
    value.extractable ||
    algorithm.name !== "AES-GCM" ||
    algorithm.length !== 256 ||
    usages.size !== 2 ||
    !usages.has("encrypt") ||
    !usages.has("decrypt")
  ) {
    throw new Error(`Invalid non-exportable AES-256-GCM binding: ${binding}`);
  }
  return value;
}

function loadKeySet(env: KeyWrappingWorkerBindings): LoadedKeySet {
  if (env.ENVIRONMENT !== "staging" && env.ENVIRONMENT !== "production") {
    throw new Error("Key-wrapping Worker is restricted to named environments");
  }
  const config = parseKeySetConfig(env.KEY_WRAPPING_KEY_SET);
  const keys = new Map<string, CryptoKey>();
  for (const configured of config.keys) {
    keys.set(
      configured.id,
      validateCryptoKey(env[configured.binding], configured.binding),
    );
  }
  return {
    activeKeyId: config.activeKeyId,
    writeKeyIds: new Set(config.writeKeyIds),
    keys,
  };
}

function validateContext(input: {
  workspaceId: unknown;
  dataKeyId: unknown;
  wrapVersion: unknown;
}): asserts input is {
  workspaceId: string;
  dataKeyId: string;
  wrapVersion: 1;
} {
  if (
    typeof input.workspaceId !== "string" ||
    input.workspaceId.length === 0 ||
    input.workspaceId.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(input.workspaceId) ||
    typeof input.dataKeyId !== "string" ||
    !DATA_KEY_ID_REGEX.test(input.dataKeyId) ||
    input.wrapVersion !== 1
  ) {
    throw new Error("Invalid workspace data key wrapping context");
  }
}

function keyWrapAad(input: {
  keyId: string;
  workspaceId: string;
  dataKeyId: string;
  wrapVersion: 1;
}): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      "zenguy",
      "workspace-data-key-wrap",
      input.wrapVersion,
      input.keyId,
      input.workspaceId,
      input.dataKeyId,
    ]),
  );
}

function parseWrappedKey(
  wrappedKey: string,
  expectedKeyId: string,
): { iv: Uint8Array; ciphertext: Uint8Array } {
  if (
    wrappedKey.length === 0 ||
    wrappedKey.length > WRAPPED_KEY_MAX_LENGTH
  ) {
    throw new Error("Invalid wrapped workspace data key format");
  }
  const parts = wrappedKey.split(":");
  if (
    parts.length !== 4 ||
    parts[0] !== "w1" ||
    parts[1] !== expectedKeyId ||
    parts[2] === undefined ||
    parts[3] === undefined
  ) {
    throw new Error("Invalid wrapped workspace data key format");
  }
  const iv = base64ToBytes(parts[2]);
  const ciphertext = base64ToBytes(parts[3]);
  if (iv.byteLength !== 12 || ciphertext.byteLength !== DATA_KEY_BYTES + 16) {
    throw new Error("Invalid wrapped workspace data key format");
  }
  return { iv, ciphertext };
}

export class KeyWrappingServiceCore implements KeyWrappingServiceBinding {
  constructor(private readonly env: KeyWrappingWorkerBindings) {}

  describeKeySet(): {
    protocolVersion: 1;
    activeKeyId: string;
    writeKeyIds: string[];
    readKeyIds: string[];
  } {
    const keySet = loadKeySet(this.env);
    return {
      protocolVersion: 1,
      activeKeyId: keySet.activeKeyId,
      writeKeyIds: [...keySet.writeKeyIds],
      readKeyIds: [...keySet.keys.keys()],
    };
  }

  async wrapDataKey(
    request: WrapDataKeyRequest,
  ): Promise<WrappedDataKeyResponse> {
    if (
      !isRecord(request) ||
      request.protocolVersion !== 1 ||
      typeof request.expectedKeyId !== "string" ||
      !(request.plaintextDataKey instanceof ArrayBuffer)
    ) {
      throw new Error("Invalid key-wrapping request");
    }
    validateContext(request);
    const keySet = loadKeySet(this.env);
    if (!keySet.writeKeyIds.has(request.expectedKeyId)) {
      throw new Error("Requested key is not authorized for key wrapping");
    }
    const wrappingKey = keySet.keys.get(request.expectedKeyId);
    if (wrappingKey === undefined) {
      throw new Error("Requested key-wrapping key is unavailable");
    }
    const plaintext = new Uint8Array(request.plaintextDataKey);
    if (plaintext.byteLength !== DATA_KEY_BYTES) {
      throw new Error("Workspace data key must be 32 bytes");
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    try {
      const encrypted = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: exactBuffer(iv),
          additionalData: exactBuffer(
            keyWrapAad({
              keyId: request.expectedKeyId,
              workspaceId: request.workspaceId,
              dataKeyId: request.dataKeyId,
              wrapVersion: 1,
            }),
          ),
          tagLength: 128,
        },
        wrappingKey,
        request.plaintextDataKey,
      );
      return {
        protocolVersion: 1,
        keyId: request.expectedKeyId,
        wrappedKey: `w1:${request.expectedKeyId}:${bytesToBase64(iv)}:${bytesToBase64(
          new Uint8Array(encrypted),
        )}`,
      };
    } finally {
      plaintext.fill(0);
    }
  }

  async unwrapDataKey(
    request: UnwrapDataKeyRequest,
  ): Promise<UnwrappedDataKeyResponse> {
    if (
      !isRecord(request) ||
      request.protocolVersion !== 1 ||
      typeof request.keyId !== "string" ||
      !KEY_ID_REGEX.test(request.keyId) ||
      typeof request.wrappedKey !== "string"
    ) {
      throw new Error("Invalid key-unwrapping request");
    }
    validateContext(request);
    const keySet = loadKeySet(this.env);
    const selected = keySet.keys.get(request.keyId);
    if (selected === undefined) {
      throw new Error("Unknown key-wrapping key id");
    }
    const { iv, ciphertext } = parseWrappedKey(
      request.wrappedKey,
      request.keyId,
    );
    let decrypted: ArrayBuffer;
    try {
      decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: exactBuffer(iv),
          additionalData: exactBuffer(
            keyWrapAad({
              keyId: request.keyId,
              workspaceId: request.workspaceId,
              dataKeyId: request.dataKeyId,
              wrapVersion: 1,
            }),
          ),
          tagLength: 128,
        },
        selected,
        exactBuffer(ciphertext),
      );
    } catch {
      throw new Error("Unable to unwrap workspace data key");
    }
    if (decrypted.byteLength !== DATA_KEY_BYTES) {
      new Uint8Array(decrypted).fill(0);
      throw new Error("Invalid unwrapped workspace data key length");
    }
    return {
      protocolVersion: 1,
      keyId: request.keyId,
      plaintextDataKey: decrypted,
    };
  }
}

/**
 * Named RPC entrypoint only. The Wrangler config deliberately gives this
 * Worker no public fetch route, workers.dev subdomain, preview URL, or trigger.
 */
export class KeyWrappingService extends WorkerEntrypoint<KeyWrappingWorkerBindings> {
  describeKeySet() {
    return new KeyWrappingServiceCore(this.env).describeKeySet();
  }

  wrapDataKey(request: WrapDataKeyRequest) {
    return new KeyWrappingServiceCore(this.env).wrapDataKey(request);
  }

  unwrapDataKey(request: UnwrapDataKeyRequest) {
    return new KeyWrappingServiceCore(this.env).unwrapDataKey(request);
  }
}

// Wrangler uses the presence of a default module export to select ES-module
// format. This inert entrypoint has no fetch/event/RPC methods; callers must be
// explicitly bound to the named KeyWrappingService capability above.
export default class PrivateDefaultEntrypoint extends WorkerEntrypoint<KeyWrappingWorkerBindings> {}
