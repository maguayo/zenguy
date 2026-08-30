const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const CNAME_TYPE = 5;

export interface CnameResolver {
  /** First CNAME target of the hostname (lowercase, no trailing dot), or null. */
  resolve(hostname: string): Promise<string | null>;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface DohAnswer {
  Status?: number;
  Answer?: { name?: string; type?: number; data?: string }[];
}

/**
 * DNS-over-HTTPS lookup against 1.1.1.1 — purely informational UX so the
 * builder can say "your CNAME points to X" before Cloudflare's own
 * validation flips the hostname to active. Failures degrade to null.
 */
export class DohCnameResolver implements CnameResolver {
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async resolve(hostname: string): Promise<string | null> {
    try {
      const response = await this.fetcher(
        `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=CNAME`,
        { headers: { accept: "application/dns-json" } },
      );
      if (!response.ok) return null;
      const parsed = (await response.json()) as DohAnswer;
      const answer = parsed.Answer?.find(
        (entry) => entry.type === CNAME_TYPE && typeof entry.data === "string",
      );
      if (answer?.data === undefined) return null;
      return answer.data.toLowerCase().replace(/\.$/u, "");
    } catch {
      return null;
    }
  }
}
