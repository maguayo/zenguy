import { isStaleDataEncryptionKeyError } from "../../domain/security/encryption";
import { conflict } from "../../shared/errors";

const MAX_ENCRYPTED_WRITE_ATTEMPTS = 3;

/**
 * Re-encrypts after a D1 active-DEK fence rejects a value produced just before
 * rotation. Only the fenced write is retried; callers must keep audit records,
 * queueing and other effects after this function returns successfully.
 */
export async function writeWithActiveDataKeyRetry<T>(
  prepare: () => Promise<T>,
  write: (prepared: T) => Promise<void>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_ENCRYPTED_WRITE_ATTEMPTS; attempt += 1) {
    const prepared = await prepare();
    try {
      await write(prepared);
      return prepared;
    } catch (error) {
      if (!isStaleDataEncryptionKeyError(error)) throw error;
      if (attempt === MAX_ENCRYPTED_WRITE_ATTEMPTS - 1) {
        throw conflict(
          "Encryption key changed repeatedly while saving; retry the request",
        );
      }
    }
  }
  throw new Error("Encrypted write retry invariant failed");
}
