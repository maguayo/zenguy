const API_BASE = "https://api.cloudflare.com/client/v4";

export interface CustomHostnameRecord {
  id: string;
  hostname: string;
  /** Cloudflare hostname status, e.g. "pending", "active", "blocked". */
  status: string;
  /** Certificate status, e.g. "pending_validation", "active"; null if absent. */
  sslStatus: string | null;
  verificationErrors: string[];
}

export interface CustomHostnameClient {
  create(hostname: string): Promise<CustomHostnameRecord>;
  get(id: string): Promise<CustomHostnameRecord | null>;
  remove(id: string): Promise<void>;
}

export class CustomHostnameApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CustomHostnameApiError";
  }
}

interface CloudflareEnvelope {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result?: {
    id?: string;
    hostname?: string;
    status?: string;
    ssl?: {
      status?: string;
      validation_errors?: { message?: string }[];
    };
  };
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function toRecord(result: NonNullable<CloudflareEnvelope["result"]>): CustomHostnameRecord {
  return {
    id: result.id ?? "",
    hostname: result.hostname ?? "",
    status: result.status ?? "pending",
    sslStatus: result.ssl?.status ?? null,
    verificationErrors: (result.ssl?.validation_errors ?? []).flatMap((entry) =>
      typeof entry.message === "string" && entry.message.length > 0
        ? [entry.message]
        : [],
    ),
  };
}

export class HttpCustomHostnameClient implements CustomHostnameClient {
  constructor(
    private readonly config: { zoneId: string; apiToken: string },
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async request(
    method: "POST" | "GET" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; envelope: CloudflareEnvelope }> {
    const response = await this.fetcher(
      `${API_BASE}/zones/${this.config.zoneId}/custom_hostnames${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    let envelope: CloudflareEnvelope;
    try {
      envelope = (await response.json()) as CloudflareEnvelope;
    } catch {
      envelope = { success: false, errors: [] };
    }
    return { status: response.status, envelope };
  }

  private static failure(
    status: number,
    envelope: CloudflareEnvelope,
  ): CustomHostnameApiError {
    const message =
      envelope.errors?.find(
        (entry) => typeof entry.message === "string" && entry.message.length > 0,
      )?.message ?? `Cloudflare custom hostname API failed (HTTP ${status})`;
    return new CustomHostnameApiError(message, status);
  }

  async create(hostname: string): Promise<CustomHostnameRecord> {
    const { status, envelope } = await this.request("POST", "", {
      hostname,
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
    });
    if (!envelope.success || envelope.result === undefined) {
      throw HttpCustomHostnameClient.failure(status, envelope);
    }
    return toRecord(envelope.result);
  }

  async get(id: string): Promise<CustomHostnameRecord | null> {
    const { status, envelope } = await this.request(
      "GET",
      `/${encodeURIComponent(id)}`,
    );
    if (status === 404) return null;
    if (!envelope.success || envelope.result === undefined) {
      throw HttpCustomHostnameClient.failure(status, envelope);
    }
    return toRecord(envelope.result);
  }

  async remove(id: string): Promise<void> {
    const { status, envelope } = await this.request(
      "DELETE",
      `/${encodeURIComponent(id)}`,
    );
    if (status === 404) return;
    if (!envelope.success && status >= 400) {
      throw HttpCustomHostnameClient.failure(status, envelope);
    }
  }
}
