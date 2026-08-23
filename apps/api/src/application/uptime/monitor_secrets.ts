import { monitorHeaderSchema } from "../../domain/uptime/rules";
import type {
  MonitorHeader,
  UptimeMonitor,
} from "../../domain/uptime/types";
import {
  decryptSecret,
  encryptSecret,
  type EncryptionKeyring,
} from "../../shared/crypto";

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
  encryptionKeys: EncryptionKeyring,
  identity: { workspaceId: string; monitorId: string },
): Promise<EncryptedMonitorSensitive> {
  const [encryptedHeaders, encryptedBody] = await Promise.all([
    input.headers === undefined
      ? Promise.resolve(null)
      : encryptSecret(JSON.stringify(input.headers), encryptionKeys, {
          type: "uptime_monitor_headers",
          workspaceId: identity.workspaceId,
          recordId: identity.monitorId,
        }),
    input.body === undefined
      ? Promise.resolve(null)
      : encryptSecret(input.body, encryptionKeys, {
          type: "uptime_monitor_body",
          workspaceId: identity.workspaceId,
          recordId: identity.monitorId,
        }),
  ]);
  return { encryptedHeaders, encryptedBody };
}

export async function decryptMonitorSensitive(
  monitor: Pick<
    UptimeMonitor,
    "id" | "workspaceId" | "encryptedHeaders" | "encryptedBody"
  >,
  encryptionKeys: EncryptionKeyring,
): Promise<DecryptedMonitorSensitive> {
  const [headersJson, body] = await Promise.all([
    monitor.encryptedHeaders === null
      ? Promise.resolve(null)
      : decryptSecret(monitor.encryptedHeaders, encryptionKeys, {
          type: "uptime_monitor_headers",
          workspaceId: monitor.workspaceId,
          recordId: monitor.id,
        }),
    monitor.encryptedBody === null
      ? Promise.resolve(null)
      : decryptSecret(monitor.encryptedBody, encryptionKeys, {
          type: "uptime_monitor_body",
          workspaceId: monitor.workspaceId,
          recordId: monitor.id,
        }),
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
  monitor: Pick<
    UptimeMonitor,
    "id" | "workspaceId" | "encryptedHeaders" | "encryptedBody"
  >,
  encryptionKeys: EncryptionKeyring,
  canReadSensitive: boolean,
): Promise<MonitorSensitiveRead> {
  if (!canReadSensitive) {
    return {
      headers: null,
      body: null,
      headersMasked: true,
    };
  }
  return {
    ...(await decryptMonitorSensitive(monitor, encryptionKeys)),
    headersMasked: false,
  };
}
