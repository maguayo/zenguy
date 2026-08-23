import type { EncryptedRecordType } from "../../shared/crypto";

export const STALE_DATA_ENCRYPTION_KEY_MARKER =
  "ZENGUY_STALE_DATA_ENCRYPTION_KEY";

export function isStaleDataEncryptionKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(STALE_DATA_ENCRYPTION_KEY_MARKER)
  );
}

export interface EncryptedRecord {
  type: EncryptedRecordType;
  workspaceId: string;
  recordId: string;
  ciphertext: string;
}

export interface EncryptionReplacement extends EncryptedRecord {
  replacement: string;
}

export interface EncryptionRotationRepo {
  listPending(
    workspaceId: string,
    activeDataKeyId: string,
    limit: number,
  ): Promise<EncryptedRecord[]>;
  replaceIfUnchanged(
    replacements: readonly EncryptionReplacement[],
    at: number,
  ): Promise<boolean[]>;
}
