import type {
  CustomHostnameClient,
  CustomHostnameRecord,
} from "../../infrastructure/cloudflare/custom_hostnames";
import type { CnameResolver } from "../../infrastructure/dns/doh";

export class FakeCustomHostnameClient implements CustomHostnameClient {
  readonly records = new Map<string, CustomHostnameRecord>();
  readonly removed: string[] = [];
  private sequence = 0;
  /** Set to make the next call fail. */
  failWith: Error | null = null;

  private throwIfFailing(): void {
    if (this.failWith !== null) {
      const error = this.failWith;
      this.failWith = null;
      throw error;
    }
  }

  async create(hostname: string): Promise<CustomHostnameRecord> {
    this.throwIfFailing();
    this.sequence += 1;
    const record: CustomHostnameRecord = {
      id: `ch_fake_${this.sequence}`,
      hostname,
      status: "pending",
      sslStatus: "pending_validation",
      verificationErrors: [],
    };
    this.records.set(record.id, record);
    return { ...record };
  }

  async get(id: string): Promise<CustomHostnameRecord | null> {
    this.throwIfFailing();
    const record = this.records.get(id);
    return record === undefined ? null : { ...record };
  }

  async remove(id: string): Promise<void> {
    this.throwIfFailing();
    this.records.delete(id);
    this.removed.push(id);
  }
}

export class FakeCnameResolver implements CnameResolver {
  readonly answers = new Map<string, string>();

  async resolve(hostname: string): Promise<string | null> {
    return this.answers.get(hostname) ?? null;
  }
}
