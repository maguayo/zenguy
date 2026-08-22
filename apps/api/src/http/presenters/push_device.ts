import { pushTokenSuffix, type PushDevice } from "../../domain/push/types";

export function presentPushDevice(device: PushDevice) {
  return {
    id: device.id,
    platform: device.platform,
    deviceName: device.deviceName,
    appVersion: device.appVersion,
    enabled: device.enabled,
    tokenSuffix: pushTokenSuffix(device.token),
    lastSeenAt: new Date(device.lastSeenAt).toISOString(),
    createdAt: new Date(device.createdAt).toISOString(),
  };
}
