/**
 * True when D1 rejected the statement because the schema is older than this
 * Worker expects (a migration that has not reached the bound database yet).
 */
export function isMigrationPendingError(error: unknown): boolean {
  return error instanceof Error && /no such (?:table|column)/iu.test(error.message);
}
