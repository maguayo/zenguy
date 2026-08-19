export interface JsonPathResult {
  found: boolean;
  value: unknown;
}

type Segment = { type: "property"; key: string } | { type: "index"; index: number };

function parse(path: string): Segment[] | null {
  let value = path;
  if (value.startsWith("$")) value = value.slice(1);
  if (value.startsWith(".")) value = value.slice(1);
  if (value.length === 0) return [];

  const segments: Segment[] = [];
  let offset = 0;
  let needsSeparator = false;
  while (offset < value.length) {
    if (value[offset] === ".") {
      if (!needsSeparator) return null;
      offset += 1;
      needsSeparator = false;
      continue;
    }
    if (value[offset] === "[") {
      const match = /^\[(\d+)\]/u.exec(value.slice(offset));
      if (match === null) return null;
      const rawIndex = match[1];
      if (rawIndex === undefined) return null;
      const index = Number(rawIndex);
      if (!Number.isSafeInteger(index)) return null;
      segments.push({ type: "index", index });
      offset += match[0].length;
      needsSeparator = true;
      continue;
    }
    if (needsSeparator) return null;
    const match = /^[A-Za-z0-9_]+/u.exec(value.slice(offset));
    if (match === null) return null;
    segments.push({ type: "property", key: match[0] });
    offset += match[0].length;
    needsSeparator = true;
  }
  return needsSeparator ? segments : null;
}

export function getJsonPath(root: unknown, path: string): JsonPathResult {
  const segments = parse(path);
  if (segments === null) return { found: false, value: undefined };
  let value = root;
  for (const segment of segments) {
    if (segment.type === "index") {
      if (!Array.isArray(value) || !(segment.index in value)) {
        return { found: false, value: undefined };
      }
      value = value[segment.index];
      continue;
    }
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !Object.prototype.hasOwnProperty.call(value, segment.key)
    ) {
      return { found: false, value: undefined };
    }
    value = (value as Record<string, unknown>)[segment.key];
  }
  return { found: true, value };
}
