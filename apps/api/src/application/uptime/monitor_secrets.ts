import { monitorHeaderSchema } from "../../domain/uptime/rules";
import type {
  MonitorHeader,
  UptimeMonitor,
} from "../../domain/uptime/types";
import { decryptSecret, encryptSecret } from "../../shared/crypto";

export interface EncryptedMonitorSensitive {
  encryptedHeaders: string | null;
  encryptedBody: string | null;
}

export interface DecryptedMonitorSensitive {
  headers: MonitorHeader[] | null;
  body: string | null;
}

export interface MonitorSensitiveRead extends DecryptedMonitorSensitive {
  headersMasked: boolean;
}

export async function encryptMonitorSensitive(
  input: { headers?: MonitorHeader[]; body?: string },
  encryptionKey: Uint8Array,
): Promise<EncryptedMonitorSensitive> {
  const [encryptedHeaders, encryptedBody] = await Promise.all([
    input.headers === undefined
      ? Promise.resolve(null)
      : encryptSecret(JSON.stringify(input.headers), encryptionKey),
    input.body === undefined
      ? Promise.resolve(null)
      : encryptSecret(input.body, encryptionKey),
  ]);
  return { encryptedHeaders, encryptedBody };
}

export async function decryptMonitorSensitive(
  monitor: Pick<UptimeMonitor, "encryptedHeaders" | "encryptedBody">,
  encryptionKey: Uint8Array,
): Promise<DecryptedMonitorSensitive> {
  const [headersJson, body] = await Promise.all([
    monitor.encryptedHeaders === null
      ? Promise.resolve(null)
      : decryptSecret(monitor.encryptedHeaders, encryptionKey),
    monitor.encryptedBody === null
      ? Promise.resolve(null)
      : decryptSecret(monitor.encryptedBody, encryptionKey),
  ]);
  return {
    headers:
      headersJson === null
        ? null
        : monitorHeaderSchema.array().max(20).parse(JSON.parse(headersJson)),
    body,
  };
}

export async function readMonitorSensitive(
  monitor: Pick<UptimeMonitor, "encryptedHeaders" | "encryptedBody">,
  encryptionKey: Uint8Array,
  canReadSensitive: boolean,
): Promise<MonitorSensitiveRead> {
  if (!canReadSensitive) {
    return {
      headers: null,
      body: null,
      headersMasked: monitor.encryptedHeaders !== null,
    };
  }
  return {
    ...(await decryptMonitorSensitive(monitor, encryptionKey)),
    headersMasked: false,
  };
}
