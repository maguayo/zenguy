export async function one<T = Record<string, unknown>>(
  statement: D1PreparedStatement,
): Promise<T | null> {
  return statement.first<T>();
}

export async function all<T = Record<string, unknown>>(
  statement: D1PreparedStatement,
): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results;
}

export async function run<T = Record<string, unknown>>(
  statement: D1PreparedStatement,
): Promise<D1Result<T>> {
  return statement.run<T>();
}

export async function batch<T = unknown>(
  database: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result<T>[]> {
  return database.batch<T>(statements);
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:UNIQUE constraint failed|SQLITE_CONSTRAINT)/u.test(error.message)
  );
}
