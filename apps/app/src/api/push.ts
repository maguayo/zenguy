import { apiDelete, apiGet, apiPatch, apiPut } from "../lib/api";

export interface PushDevice {
  appVersion: string | null;
  createdAt: string;
  deviceName: string | null;
  enabled: boolean;
  id: string;
  lastSeenAt: string;
  platform: "android" | "ios";
  tokenSuffix: string;
}

export interface RegisterPushDeviceInput {
  appVersion?: string;
  deviceName?: string;
  platform: "ios";
  token: string;
}

function devicePath(deviceId: string): string {
  return `/api/me/push-devices/${encodeURIComponent(deviceId)}`;
}

export function listPushDevices(): Promise<PushDevice[]> {
  return apiGet("/api/me/push-devices");
}

/** Idempotent per token: re-registering reassigns the token to the signed-in user. */
export function registerPushDevice(input: RegisterPushDeviceInput): Promise<PushDevice> {
  return apiPut("/api/me/push-devices", input);
}

export function updatePushDevice(deviceId: string, input: { enabled: boolean }): Promise<PushDevice> {
  return apiPatch(devicePath(deviceId), input);
}

export function removePushDevice(deviceId: string): Promise<void> {
  return apiDelete(devicePath(deviceId));
}
