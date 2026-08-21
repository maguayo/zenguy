// Ported from apps/frontend/src/components/KeyValueEditor.tsx (pure part).

export interface KeyValueRow {
  key: string;
  value: string;
}

export function addKeyValue(rows: KeyValueRow[]): KeyValueRow[] {
  return [...rows, { key: "", value: "" }];
}

export function changeKeyValue(
  rows: KeyValueRow[],
  index: number,
  field: keyof KeyValueRow,
  value: string,
): KeyValueRow[] {
  return rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row));
}

export function removeKeyValue(rows: KeyValueRow[], index: number): KeyValueRow[] {
  return rows.filter((_, rowIndex) => rowIndex !== index);
}

export interface KeyValueRowError {
  key?: string;
  value?: string;
}

function messageOf(candidate: unknown): string | undefined {
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const message = (candidate as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

/** Per-row messages from a react-hook-form `errors.headers` array. */
export function keyValueRowErrors(errors: unknown): (KeyValueRowError | undefined)[] | undefined {
  if (!Array.isArray(errors)) return undefined;
  return errors.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return undefined;
    const row = entry as { key?: unknown; value?: unknown };
    const key = messageOf(row.key);
    const value = messageOf(row.value);
    return key || value ? { key, value } : undefined;
  });
}

/** The list-level message (e.g. too many rows), never a per-row one. */
export function keyValueListError(errors: unknown): string | undefined {
  return Array.isArray(errors) ? undefined : messageOf(errors);
}
