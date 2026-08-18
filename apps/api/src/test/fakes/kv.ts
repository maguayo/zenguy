import type { Clock } from "../../shared/clock";

interface StoredValue {
  value: string;
  expiresAt: number | null;
  metadata: unknown;
}

function requestedType(options: unknown): "text" | "json" | "arrayBuffer" | "stream" {
  if (
    options === "json" ||
    options === "arrayBuffer" ||
    options === "stream" ||
    options === "text"
  ) {
    return options;
  }
  if (
    typeof options === "object" &&
    options !== null &&
    "type" in options &&
    (options.type === "json" ||
      options.type === "arrayBuffer" ||
      options.type === "stream" ||
      options.type === "text")
  ) {
    return options.type;
  }
  return "text";
}

function encodeValue(
  value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  throw new Error("FakeKv does not accept streaming writes");
}

export class FakeKv implements KVNamespace {
  private readonly values = new Map<string, StoredValue>();

  constructor(private readonly clock: Clock) {}

  private read(key: string): StoredValue | null {
    const entry = this.values.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= this.clock.now()) {
      this.values.delete(key);
      return null;
    }
    return entry;
  }

  private decodedValue(key: string, options?: unknown): unknown {
    const entry = this.read(key);
    if (entry === null) {
      return null;
    }
    switch (requestedType(options)) {
      case "json":
        return JSON.parse(entry.value) as unknown;
      case "arrayBuffer":
        return new TextEncoder().encode(entry.value).buffer;
      case "stream":
        return new Response(entry.value).body;
      case "text":
        return entry.value;
    }
  }

  get = (async (
    key: string | string[],
    options?: unknown,
  ): Promise<unknown> => {
    if (Array.isArray(key)) {
      return new Map(key.map((item) => [item, this.decodedValue(item, options)]));
    }
    return this.decodedValue(key, options);
  }) as KVNamespace["get"];

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options: KVNamespacePutOptions = {},
  ): Promise<void> {
    const expiresAt =
      options.expiration !== undefined
        ? options.expiration * 1000
        : options.expirationTtl !== undefined
          ? this.clock.now() + options.expirationTtl * 1000
          : null;
    this.values.set(key, {
      value: encodeValue(value),
      expiresAt,
      metadata: options.metadata ?? null,
    });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  list = (async <Metadata = unknown>(
    options: KVNamespaceListOptions = {},
  ): Promise<KVNamespaceListResult<Metadata, string>> => {
    for (const key of this.values.keys()) {
      this.read(key);
    }
    const prefix = options.prefix ?? "";
    const allKeys = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    const offset = options.cursor === undefined || options.cursor === null
      ? 0
      : Number.parseInt(options.cursor, 10);
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const limit = options.limit ?? 1000;
    const page = allKeys.slice(start, start + limit);
    const keys = page.map(([name, entry]) => ({
      name,
      ...(entry.expiresAt === null
        ? {}
        : { expiration: Math.floor(entry.expiresAt / 1000) }),
      metadata: entry.metadata as Metadata,
    }));
    const next = start + page.length;
    if (next < allKeys.length) {
      return {
        list_complete: false,
        keys,
        cursor: String(next),
        cacheStatus: null,
      };
    }
    return { list_complete: true, keys, cacheStatus: null };
  }) as KVNamespace["list"];

  getWithMetadata = (async (
    key: string | string[],
    options?: unknown,
  ): Promise<unknown> => {
    const resultFor = (item: string) => ({
      value: this.decodedValue(item, options),
      metadata: this.read(item)?.metadata ?? null,
      cacheStatus: null,
    });
    if (Array.isArray(key)) {
      return new Map(key.map((item) => [item, resultFor(item)]));
    }
    return resultFor(key);
  }) as KVNamespace["getWithMetadata"];
}
