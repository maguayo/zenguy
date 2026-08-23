import {
  PASSWORD_HASH_SCHEME,
  PASSWORD_HASH_VERSION,
  PBKDF2_ITERATIONS,
  PBKDF2_MAX_VERIFY_ITERATIONS,
} from "./constants";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ENCRYPTION_KEY_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const DATA_KEY_ID_REGEX = /^dek-[A-Za-z0-9_-]{24}$/u;
const DATA_KEY_BYTES = 32;
const WRAP_VERSION = 1 as const;

export const CURRENT_ENCRYPTION_VERSION = 4 as const;

export type EncryptedRecordType =
  | "workspace_secret"
  | "notification_channel"
  | "uptime_monitor_headers"
  | "uptime_monitor_body";

export interface EncryptionContext {
  type: EncryptedRecordType;
  workspaceId: string;
  recordId: string;
}

export interface EncryptionKeyVersion {
  id: string;
  key: Uint8Array;
}

export interface WorkspaceDataKeyRecord {
  workspaceId: string;
  id: string;
  generation: number;
  wrappingKeyId: string;
  wrapVersion: 1;
  wrappedKey: string;
  active: boolean;
  createdAt: number;
  retiredAt: number | null;
}

export interface WorkspaceDataKeyStore {
  findActive(workspaceId: string): Promise<WorkspaceDataKeyRecord | null>;
  findById(
    workspaceId: string,
    dataKeyId: string,
  ): Promise<WorkspaceDataKeyRecord | null>;
  insertActiveIfAbsent(
    candidate: WorkspaceDataKeyRecord,
  ): Promise<WorkspaceDataKeyRecord | null>;
  activate(
    candidate: WorkspaceDataKeyRecord,
    expectedActiveId: string,
    retiredAt: number,
  ): Promise<WorkspaceDataKeyRecord | null>;
  replaceWrappedKeyIfUnchanged(input: {
    workspaceId: string;
    dataKeyId: string;
    expectedWrappingKeyId: string;
    expectedWrappedKey: string;
    wrappingKeyId: string;
    wrappedKey: string;
  }): Promise<boolean>;
}

export interface KeyWrapContext {
  workspaceId: string;
  dataKeyId: string;
  wrappingKeyId: string;
  wrapVersion: 1;
}

export interface KeyEncryptionProvider {
  readonly activeKeyId: string;
  wrapKey(
    plaintextDataKey: Uint8Array,
    context: Omit<KeyWrapContext, "wrappingKeyId">,
  ): Promise<{ wrappingKeyId: string; wrappedKey: string }>;
  unwrapKey(
    wrappedKey: string,
    context: KeyWrapContext,
  ): Promise<Uint8Array>;
}

/**
 * The configured roots are KEKs for v4 workspace data keys and remain read
 * keys for the legacy v1-v3 formats. New data is never encrypted directly or
 * deterministically with these roots. Named Cloudflare environments inject a
 * private Service-Binding provider backed by non-exportable secret_key
 * bindings; the local provider exists only for development and tests.
 */
export interface EncryptionKeyring {
  active: EncryptionKeyVersion;
  previous: readonly EncryptionKeyVersion[];
  workspaceDataKeys: WorkspaceDataKeyStore;
  keyEncryption: KeyEncryptionProvider;
}

export interface EncryptedValueInfo {
  version: 1 | 2 | 3 | 4;
  keyId: string | null;
}

export interface ActiveWorkspaceDataKey {
  id: string;
  generation: number;
  wrappingKeyId: string;
}

function validateEncryptionKeyVersion(
  version: EncryptionKeyVersion,
): EncryptionKeyVersion {
  if (!ENCRYPTION_KEY_ID_REGEX.test(version.id)) {
    throw new Error(
      "Encryption key id must be 1-64 letters, numbers, dots, underscores, or hyphens",
    );
  }
  if (version.key.byteLength !== 32) {
    throw new Error("Encryption key must be 32 bytes");
  }
  return { id: version.id, key: Uint8Array.from(version.key) };
}

function validateWorkspaceDataKeyRecord(
  record: WorkspaceDataKeyRecord,
): WorkspaceDataKeyRecord {
  if (record.workspaceId.length === 0) {
    throw new Error("Workspace data key requires a workspace id");
  }
  if (!DATA_KEY_ID_REGEX.test(record.id)) {
    throw new Error("Invalid workspace data key id");
  }
  if (!Number.isSafeInteger(record.generation) || record.generation < 1) {
    throw new Error("Invalid workspace data key generation");
  }
  if (!ENCRYPTION_KEY_ID_REGEX.test(record.wrappingKeyId)) {
    throw new Error("Invalid workspace wrapping key id");
  }
  if (record.wrapVersion !== WRAP_VERSION || record.wrappedKey.length === 0) {
    throw new Error("Invalid wrapped workspace data key");
  }
  if (!Number.isSafeInteger(record.createdAt) || record.createdAt < 0) {
    throw new Error("Invalid workspace data key creation time");
  }
  if (
    (record.active && record.retiredAt !== null) ||
    (!record.active &&
      (record.retiredAt === null ||
        !Number.isSafeInteger(record.retiredAt) ||
        record.retiredAt < record.createdAt))
  ) {
    throw new Error("Invalid workspace data key lifecycle");
  }
  return { ...record };
}

class MemoryWorkspaceDataKeyStore implements WorkspaceDataKeyStore {
  private readonly records = new Map<string, WorkspaceDataKeyRecord>();

  private key(workspaceId: string, dataKeyId: string): string {
    return `${workspaceId}\u0000${dataKeyId}`;
  }

  private activeRecord(workspaceId: string): WorkspaceDataKeyRecord | null {
    for (const record of this.records.values()) {
      if (record.workspaceId === workspaceId && record.active) return record;
    }
    return null;
  }

  async findActive(workspaceId: string): Promise<WorkspaceDataKeyRecord | null> {
    const record = this.activeRecord(workspaceId);
    return record === null ? null : { ...record };
  }

  async findById(
    workspaceId: string,
    dataKeyId: string,
  ): Promise<WorkspaceDataKeyRecord | null> {
    const record = this.records.get(this.key(workspaceId, dataKeyId));
    return record === undefined ? null : { ...record };
  }

  async insertActiveIfAbsent(
    candidate: WorkspaceDataKeyRecord,
  ): Promise<WorkspaceDataKeyRecord | null> {
    const existing = this.activeRecord(candidate.workspaceId);
    if (existing !== null) return { ...existing };
    const validated = validateWorkspaceDataKeyRecord(candidate);
    if (!validated.active) throw new Error("New workspace data key must be active");
    const key = this.key(validated.workspaceId, validated.id);
    if (this.records.has(key)) return null;
    this.records.set(key, validated);
    return { ...validated };
  }

  async activate(
    candidate: WorkspaceDataKeyRecord,
    expectedActiveId: string,
    retiredAt: number,
  ): Promise<WorkspaceDataKeyRecord | null> {
    const active = this.activeRecord(candidate.workspaceId);
    if (active?.id !== expectedActiveId) return null;
    const validated = validateWorkspaceDataKeyRecord(candidate);
    const key = this.key(validated.workspaceId, validated.id);
    if (this.records.has(key)) return null;
    this.records.set(this.key(active.workspaceId, active.id), {
      ...active,
      active: false,
      retiredAt,
    });
    this.records.set(key, validated);
    return { ...validated };
  }

  async replaceWrappedKeyIfUnchanged(input: {
    workspaceId: string;
    dataKeyId: string;
    expectedWrappingKeyId: string;
    expectedWrappedKey: string;
    wrappingKeyId: string;
    wrappedKey: string;
  }): Promise<boolean> {
    const key = this.key(input.workspaceId, input.dataKeyId);
    const current = this.records.get(key);
    if (
      current === undefined ||
      current.wrappingKeyId !== input.expectedWrappingKeyId ||
      current.wrappedKey !== input.expectedWrappedKey
    ) {
      return false;
    }
    this.records.set(key, {
      ...current,
      wrappingKeyId: input.wrappingKeyId,
      wrappedKey: input.wrappedKey,
    });
    return true;
  }
}

function keyWrapAad(context: KeyWrapContext): Uint8Array {
  if (
    context.workspaceId.length === 0 ||
    !DATA_KEY_ID_REGEX.test(context.dataKeyId) ||
    !ENCRYPTION_KEY_ID_REGEX.test(context.wrappingKeyId) ||
    context.wrapVersion !== WRAP_VERSION
  ) {
    throw new Error("Invalid workspace data key wrapping context");
  }
  return encoder.encode(
    JSON.stringify([
      "zenguy",
      "workspace-data-key-wrap",
      context.wrapVersion,
      context.wrappingKeyId,
      context.workspaceId,
      context.dataKeyId,
    ]),
  );
}

class LocalAesGcmKeyEncryptionProvider implements KeyEncryptionProvider {
  readonly activeKeyId: string;

  constructor(private readonly roots: readonly EncryptionKeyVersion[]) {
    const active = roots[0];
    if (active === undefined) throw new Error("Active encryption key is required");
    this.activeKeyId = active.id;
  }

  async wrapKey(
    plaintextDataKey: Uint8Array,
    context: Omit<KeyWrapContext, "wrappingKeyId">,
  ): Promise<{ wrappingKeyId: string; wrappedKey: string }> {
    if (plaintextDataKey.byteLength !== DATA_KEY_BYTES) {
      throw new Error("Workspace data key must be 32 bytes");
    }
    const active = this.roots[0];
    if (active === undefined) throw new Error("Active encryption key is required");
    const fullContext = { ...context, wrappingKeyId: active.id };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappingKey = await importAesKey(active.key, "encrypt");
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: exactBuffer(iv),
        additionalData: exactBuffer(keyWrapAad(fullContext)),
        tagLength: 128,
      },
      wrappingKey,
      exactBuffer(plaintextDataKey),
    );
    return {
      wrappingKeyId: active.id,
      wrappedKey: `w1:${active.id}:${bytesToBase64(iv)}:${bytesToBase64(
        new Uint8Array(ciphertext),
      )}`,
    };
  }

  async unwrapKey(
    wrappedKey: string,
    context: KeyWrapContext,
  ): Promise<Uint8Array> {
    const parts = wrappedKey.split(":");
    const embeddedKeyId = parts[1];
    const ivPart = parts[2];
    const ciphertextPart = parts[3];
    if (
      parts.length !== 4 ||
      parts[0] !== "w1" ||
      embeddedKeyId === undefined ||
      embeddedKeyId !== context.wrappingKeyId ||
      ivPart === undefined ||
      ciphertextPart === undefined
    ) {
      throw new Error("Invalid wrapped workspace data key format");
    }
    const selected = this.roots.find((root) => root.id === embeddedKeyId);
    if (selected === undefined) {
      throw new Error(`Unknown wrapping key id: ${embeddedKeyId}`);
    }
    const iv = base64ToBytes(ivPart);
    if (iv.byteLength !== 12) {
      throw new Error("Invalid wrapped workspace data key IV");
    }
    const ciphertext = base64ToBytes(ciphertextPart);
    const wrappingKey = await importAesKey(selected.key, "decrypt");
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: exactBuffer(iv),
          additionalData: exactBuffer(keyWrapAad(context)),
          tagLength: 128,
        },
        wrappingKey,
        exactBuffer(ciphertext),
      ),
    );
    if (plaintext.byteLength !== DATA_KEY_BYTES) {
      throw new Error("Invalid unwrapped workspace data key length");
    }
    return plaintext;
  }
}

export function createEncryptionKeyring(
  active: EncryptionKeyVersion,
  previous: readonly EncryptionKeyVersion[] = [],
  options: {
    workspaceDataKeys?: WorkspaceDataKeyStore;
    keyEncryption?: KeyEncryptionProvider;
  } = {},
): EncryptionKeyring {
  if (previous.length > 8) {
    throw new Error("At most 8 previous encryption keys are supported");
  }
  const validated = [active, ...previous].map(validateEncryptionKeyVersion);
  const ids = new Set<string>();
  for (const version of validated) {
    if (ids.has(version.id)) {
      throw new Error(`Duplicate encryption key id: ${version.id}`);
    }
    ids.add(version.id);
  }
  const current = validated[0];
  if (current === undefined) throw new Error("Active encryption key is required");
  return {
    active: current,
    previous: Object.freeze(validated.slice(1)),
    // The in-memory default keeps pure unit/migration helpers ergonomic. The
    // production config always injects the D1 implementation explicitly.
    workspaceDataKeys:
      options.workspaceDataKeys ?? new MemoryWorkspaceDataKeyStore(),
    keyEncryption:
      options.keyEncryption ?? new LocalAesGcmKeyEncryptionProvider(validated),
  };
}

function validateEncryptionContext(context: EncryptionContext): void {
  switch (context.type) {
    case "workspace_secret":
    case "notification_channel":
    case "uptime_monitor_headers":
    case "uptime_monitor_body":
      break;
    default:
      throw new Error("Unsupported encrypted record type");
  }
  if (context.workspaceId.length === 0 || context.recordId.length === 0) {
    throw new Error("Encryption context requires workspace and record ids");
  }
}

function encryptionAad(
  context: EncryptionContext,
  keyReference: string,
  version: 2 | 3 | 4,
): Uint8Array {
  validateEncryptionContext(context);
  // A JSON tuple is deterministic and collision-safe even if an identifier
  // contains punctuation. Bind the envelope key id as well as the mandatory
  // record type, workspace, record id, and format version.
  return encoder.encode(
    JSON.stringify([
      "zenguy",
      version,
      keyReference,
      context.type,
      context.workspaceId,
      context.recordId,
    ]),
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new Error("Invalid base64url value");
  }
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return base64ToBytes(padded);
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(encoded: string): Uint8Array {
  if (!/^[0-9a-f]+$/iu.test(encoded) || encoded.length % 2 !== 0) {
    throw new Error("Invalid hex value");
  }
  const bytes = new Uint8Array(encoded.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = encoded.slice(index * 2, index * 2 + 2);
    bytes[index] = Number.parseInt(pair, 16);
  }
  return bytes;
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: exactBuffer(salt),
      iterations,
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;

interface ParsedPasswordHash {
  iterations: number;
  salt: Uint8Array;
  expected: Uint8Array;
  currentFormat: boolean;
  normalize: boolean;
}

function decodeCanonicalBase64(encoded: string): Uint8Array | null {
  try {
    const decoded = base64ToBytes(encoded);
    return bytesToBase64(decoded) === encoded ? decoded : null;
  } catch {
    return null;
  }
}

function parsePasswordHash(stored: string): ParsedPasswordHash | null {
  const parts = stored.split("$");
  let currentFormat = false;
  let encodedIterations: string | undefined;
  let saltPart: string | undefined;
  let hashPart: string | undefined;

  if (
    parts.length === 5 &&
    parts[0] === PASSWORD_HASH_SCHEME &&
    parts[1] === PASSWORD_HASH_VERSION
  ) {
    currentFormat = true;
    encodedIterations = parts[2];
    saltPart = parts[3];
    hashPart = parts[4];
  } else if (parts.length === 4 && parts[0] === "pbkdf2") {
    // Historical format: PBKDF2-HMAC-SHA256 over the exact submitted UTF-8
    // bytes. It stays read-only until a successful login writes current v1.
    encodedIterations = parts[1];
    saltPart = parts[2];
    hashPart = parts[3];
  } else {
    return null;
  }

  const iterations = Number(encodedIterations);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations <= 0 ||
    iterations > PBKDF2_MAX_VERIFY_ITERATIONS ||
    (currentFormat && String(iterations) !== encodedIterations) ||
    saltPart === undefined ||
    hashPart === undefined
  ) {
    return null;
  }
  const salt = decodeCanonicalBase64(saltPart);
  const expected = decodeCanonicalBase64(hashPart);
  if (
    salt?.byteLength !== PASSWORD_SALT_BYTES ||
    expected?.byteLength !== PASSWORD_HASH_BYTES
  ) {
    return null;
  }
  return {
    iterations,
    salt,
    expected,
    currentFormat,
    normalize: currentFormat,
  };
}

export function timingSafeEqualBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function timingSafeEqualText(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return timingSafeEqualBytes(
    new Uint8Array(leftDigest),
    new Uint8Array(rightDigest),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePasswordHash(
    password.normalize("NFC"),
    salt,
    PBKDF2_ITERATIONS,
  );
  return `${PASSWORD_HASH_SCHEME}$${PASSWORD_HASH_VERSION}$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    const parsed = parsePasswordHash(stored);
    if (parsed === null) return false;
    const actual = await derivePasswordHash(
      parsed.normalize ? password.normalize("NFC") : password,
      parsed.salt,
      parsed.iterations,
    );
    return timingSafeEqualBytes(actual, parsed.expected);
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(stored: string): boolean {
  const parsed = parsePasswordHash(stored);
  return (
    parsed === null ||
    !parsed.currentFormat ||
    parsed.iterations < PBKDF2_ITERATIONS
  );
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

export function randomToken(bytes = 32): string {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error("Token byte length must be a positive integer");
  }
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function importAesKey(
  key: Uint8Array,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  if (key.byteLength !== 32) throw new Error("Encryption key must be 32 bytes");
  return crypto.subtle.importKey(
    "raw",
    exactBuffer(key),
    { name: "AES-GCM" },
    false,
    [usage],
  );
}

async function deriveLegacyV3WorkspaceAesKey(
  rootKey: Uint8Array,
  workspaceId: string,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    exactBuffer(rootKey),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: exactBuffer(
        encoder.encode("zenguy/workspace-dek/hkdf-sha256/v1"),
      ),
      info: exactBuffer(
        encoder.encode(
          JSON.stringify(["zenguy", "workspace-dek", 1, workspaceId]),
        ),
      ),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

function workspaceDataKeyId(): string {
  return `dek-${randomToken(18)}`;
}

async function newWorkspaceDataKeyRecord(input: {
  keys: EncryptionKeyring;
  workspaceId: string;
  generation: number;
  createdAt: number;
}): Promise<WorkspaceDataKeyRecord> {
  const plaintext = crypto.getRandomValues(new Uint8Array(DATA_KEY_BYTES));
  const id = workspaceDataKeyId();
  let wrapped: { wrappingKeyId: string; wrappedKey: string };
  try {
    wrapped = await input.keys.keyEncryption.wrapKey(plaintext, {
      workspaceId: input.workspaceId,
      dataKeyId: id,
      wrapVersion: WRAP_VERSION,
    });
  } finally {
    plaintext.fill(0);
  }
  if (wrapped.wrappingKeyId !== input.keys.keyEncryption.activeKeyId) {
    throw new Error("Key-encryption provider returned a non-active wrapping key");
  }
  return validateWorkspaceDataKeyRecord({
    workspaceId: input.workspaceId,
    id,
    generation: input.generation,
    wrappingKeyId: wrapped.wrappingKeyId,
    wrapVersion: WRAP_VERSION,
    wrappedKey: wrapped.wrappedKey,
    active: true,
    createdAt: input.createdAt,
    retiredAt: null,
  });
}

async function unwrapWorkspaceDataKey(
  keys: EncryptionKeyring,
  record: WorkspaceDataKeyRecord,
): Promise<Uint8Array> {
  const validated = validateWorkspaceDataKeyRecord(record);
  const plaintext = await keys.keyEncryption.unwrapKey(validated.wrappedKey, {
    workspaceId: validated.workspaceId,
    dataKeyId: validated.id,
    wrappingKeyId: validated.wrappingKeyId,
    wrapVersion: validated.wrapVersion,
  });
  try {
    if (validated.wrappingKeyId !== keys.keyEncryption.activeKeyId) {
      // Re-wrapping a DEK changes only its envelope, not data ciphertext. The
      // compare-and-swap prevents a concurrent rotation from being overwritten.
      const replacement = await keys.keyEncryption.wrapKey(plaintext, {
        workspaceId: validated.workspaceId,
        dataKeyId: validated.id,
        wrapVersion: validated.wrapVersion,
      });
      if (replacement.wrappingKeyId !== keys.keyEncryption.activeKeyId) {
        throw new Error(
          "Key-encryption provider returned a non-active wrapping key",
        );
      }
      const replaced = await keys.workspaceDataKeys.replaceWrappedKeyIfUnchanged({
        workspaceId: validated.workspaceId,
        dataKeyId: validated.id,
        expectedWrappingKeyId: validated.wrappingKeyId,
        expectedWrappedKey: validated.wrappedKey,
        wrappingKeyId: replacement.wrappingKeyId,
        wrappedKey: replacement.wrappedKey,
      });
      if (!replaced) {
        const current = await keys.workspaceDataKeys.findById(
          validated.workspaceId,
          validated.id,
        );
        if (current?.wrappingKeyId !== keys.keyEncryption.activeKeyId) {
          throw new Error("Concurrent workspace data key re-wrap did not converge");
        }
      }
    }
  } catch (error) {
    plaintext.fill(0);
    throw error;
  }
  return plaintext;
}

async function ensureActiveWorkspaceDataKeyRecord(
  keys: EncryptionKeyring,
  workspaceId: string,
): Promise<WorkspaceDataKeyRecord> {
  if (workspaceId.length === 0) {
    throw new Error("Encryption context requires workspace and record ids");
  }
  const existing = await keys.workspaceDataKeys.findActive(workspaceId);
  if (existing !== null) return validateWorkspaceDataKeyRecord(existing);

  // A random ID collision is not a recoverable cryptographic state; retry a
  // bounded number of times, then fail closed rather than reuse any key.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await newWorkspaceDataKeyRecord({
      keys,
      workspaceId,
      generation: 1,
      createdAt: Date.now(),
    });
    const winner = await keys.workspaceDataKeys.insertActiveIfAbsent(
      candidate,
    );
    if (winner !== null) return validateWorkspaceDataKeyRecord(winner);
  }
  throw new Error("Unable to create workspace data key");
}

export async function getActiveWorkspaceDataKey(
  keys: EncryptionKeyring,
  workspaceId: string,
): Promise<ActiveWorkspaceDataKey> {
  const record = await ensureActiveWorkspaceDataKeyRecord(keys, workspaceId);
  const plaintext = await unwrapWorkspaceDataKey(keys, record);
  plaintext.fill(0);
  return {
    id: record.id,
    generation: record.generation,
    wrappingKeyId: keys.keyEncryption.activeKeyId,
  };
}

export async function rotateWorkspaceDataKey(
  keys: EncryptionKeyring,
  workspaceId: string,
  expectedActiveId: string,
  at: number,
): Promise<ActiveWorkspaceDataKey> {
  if (!DATA_KEY_ID_REGEX.test(expectedActiveId)) {
    throw new Error("Invalid expected workspace data key id");
  }
  if (!Number.isSafeInteger(at) || at < 0) {
    throw new Error("Invalid workspace data key rotation time");
  }
  const active = await ensureActiveWorkspaceDataKeyRecord(keys, workspaceId);
  if (active.id !== expectedActiveId) {
    throw new Error("Workspace data key changed; reload before rotating");
  }
  const candidate = await newWorkspaceDataKeyRecord({
    keys,
    workspaceId,
    generation: active.generation + 1,
    createdAt: at,
  });
  const activated = await keys.workspaceDataKeys.activate(
    candidate,
    expectedActiveId,
    at,
  );
  if (activated === null) {
    throw new Error("Workspace data key changed; reload before rotating");
  }
  return {
    id: activated.id,
    generation: activated.generation,
    wrappingKeyId: activated.wrappingKeyId,
  };
}

export function encryptedValueInfo(encoded: string): EncryptedValueInfo {
  const parts = encoded.split(":");
  if (parts.length === 3 && parts[0] === "v1") {
    return { version: 1, keyId: null };
  }
  if (
    parts.length === 4 &&
    (parts[0] === "v2" || parts[0] === "v3" || parts[0] === "v4") &&
    parts[1] !== undefined &&
    (parts[0] === "v4"
      ? DATA_KEY_ID_REGEX.test(parts[1])
      : ENCRYPTION_KEY_ID_REGEX.test(parts[1]))
  ) {
    return {
      version: parts[0] === "v2" ? 2 : parts[0] === "v3" ? 3 : 4,
      keyId: parts[1],
    };
  }
  throw new Error("Unsupported encrypted value format");
}

export async function encryptSecret(
  plaintext: string,
  keys: EncryptionKeyring,
  context: EncryptionContext,
): Promise<string> {
  validateEncryptionContext(context);
  const active = await ensureActiveWorkspaceDataKeyRecord(
    keys,
    context.workspaceId,
  );
  const plaintextDataKey = await unwrapWorkspaceDataKey(keys, active);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await importAesKey(plaintextDataKey, "encrypt");
  } finally {
    plaintextDataKey.fill(0);
  }
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: exactBuffer(iv),
      additionalData: exactBuffer(
        encryptionAad(context, active.id, CURRENT_ENCRYPTION_VERSION),
      ),
      tagLength: 128,
    },
    cryptoKey,
    encoder.encode(plaintext),
  );
  return `v4:${active.id}:${bytesToBase64(iv)}:${bytesToBase64(
    new Uint8Array(ciphertext),
  )}`;
}

/**
 * Migration/test helper for the former v3 format, which deterministically
 * derived one workspace key from the configured root. Production writers use
 * encryptSecret (v4) with random persisted workspace DEKs.
 */
export async function encryptV3SecretForMigration(
  plaintext: string,
  keys: EncryptionKeyring,
  context: EncryptionContext,
): Promise<string> {
  validateEncryptionContext(context);
  const active = validateEncryptionKeyVersion(keys.active);
  const cryptoKey = await deriveLegacyV3WorkspaceAesKey(
    active.key,
    context.workspaceId,
    "encrypt",
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: exactBuffer(iv),
      additionalData: exactBuffer(encryptionAad(context, active.id, 3)),
      tagLength: 128,
    },
    cryptoKey,
    encoder.encode(plaintext),
  );
  return `v3:${active.id}:${bytesToBase64(iv)}:${bytesToBase64(
    new Uint8Array(ciphertext),
  )}`;
}

/**
 * Migration/test helper for the former v2 format, which used the configured
 * root key directly. Production writers must use encryptSecret (v4).
 */
export async function encryptV2SecretForMigration(
  plaintext: string,
  keys: EncryptionKeyring,
  context: EncryptionContext,
): Promise<string> {
  validateEncryptionContext(context);
  const active = validateEncryptionKeyVersion(keys.active);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await importAesKey(active.key, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: exactBuffer(iv),
      additionalData: exactBuffer(encryptionAad(context, active.id, 2)),
      tagLength: 128,
    },
    cryptoKey,
    encoder.encode(plaintext),
  );
  return `v2:${active.id}:${bytesToBase64(iv)}:${bytesToBase64(
    new Uint8Array(ciphertext),
  )}`;
}

async function decryptV1WithKey(
  encoded: string,
  key: Uint8Array,
): Promise<string> {
  const parts = encoded.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Invalid v1 encrypted value format");
  }
  const ivPart = parts[1];
  const ciphertextPart = parts[2];
  if (ivPart === undefined || ciphertextPart === undefined) {
    throw new Error("Invalid encrypted value format");
  }
  const iv = base64ToBytes(ivPart);
  if (iv.byteLength !== 12) {
    throw new Error("Invalid encrypted value IV");
  }
  const ciphertext = base64ToBytes(ciphertextPart);
  const cryptoKey = await importAesKey(key, "decrypt");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: exactBuffer(iv), tagLength: 128 },
    cryptoKey,
    exactBuffer(ciphertext),
  );
  return decoder.decode(plaintext);
}

/**
 * Migration/test helper only. Production writers must use encryptSecret so
 * every new value is a v4 envelope authenticated with record-specific AAD
 * under a random tenant DEK.
 */
export async function encryptLegacySecretForMigration(
  plaintext: string,
  key: Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await importAesKey(key, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: exactBuffer(iv), tagLength: 128 },
    cryptoKey,
    encoder.encode(plaintext),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(
  encoded: string,
  keys: EncryptionKeyring,
  context: EncryptionContext,
): Promise<string> {
  validateEncryptionContext(context);
  const info = encryptedValueInfo(encoded);
  if (info.version === 1) {
    // v1 did not carry a key id. Keep this fallback bounded and only for the
    // explicitly configured active/previous set so rollout and rotation can
    // complete without accepting arbitrary keys.
    let lastError: unknown = new Error("Unable to decrypt legacy value");
    for (const version of [keys.active, ...keys.previous]) {
      try {
        return await decryptV1WithKey(encoded, version.key);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  const keyId = info.keyId;
  if (keyId === null) throw new Error("Missing encryption key id");
  const parts = encoded.split(":");
  const ivPart = parts[2];
  const ciphertextPart = parts[3];
  if (ivPart === undefined || ciphertextPart === undefined) {
    throw new Error("Invalid encrypted value format");
  }
  const iv = base64ToBytes(ivPart);
  if (iv.byteLength !== 12) throw new Error("Invalid encrypted value IV");
  const ciphertext = base64ToBytes(ciphertextPart);
  let cryptoKey: CryptoKey;
  if (info.version === CURRENT_ENCRYPTION_VERSION) {
    const dataKey = await keys.workspaceDataKeys.findById(
      context.workspaceId,
      keyId,
    );
    if (dataKey === null) {
      throw new Error(`Unknown workspace data key id: ${keyId}`);
    }
    const plaintextDataKey = await unwrapWorkspaceDataKey(keys, dataKey);
    try {
      cryptoKey = await importAesKey(plaintextDataKey, "decrypt");
    } finally {
      plaintextDataKey.fill(0);
    }
  } else {
    const selected = [keys.active, ...keys.previous].find(
      (version) => version.id === keyId,
    );
    if (selected === undefined) {
      throw new Error(`Unknown encryption key id: ${keyId}`);
    }
    cryptoKey =
      info.version === 3
        ? await deriveLegacyV3WorkspaceAesKey(
            selected.key,
            context.workspaceId,
            "decrypt",
          )
        : await importAesKey(selected.key, "decrypt");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: exactBuffer(iv),
      additionalData: exactBuffer(encryptionAad(context, keyId, info.version)),
      tagLength: 128,
    },
    cryptoKey,
    exactBuffer(ciphertext),
  );
  return decoder.decode(plaintext);
}

export async function hmacSign(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function hmacVerify(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  try {
    const expected = base64UrlToBytes(await hmacSign(secret, payload));
    const actual = base64UrlToBytes(signature);
    return timingSafeEqualBytes(expected, actual);
  } catch {
    return false;
  }
}

export async function hmacSha256Hex(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function hmacVerifyHex(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  try {
    const expected = hexToBytes(await hmacSha256Hex(secret, payload));
    const actual = hexToBytes(signature);
    return timingSafeEqualBytes(expected, actual);
  } catch {
    return false;
  }
}
