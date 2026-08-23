import { act, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import * as Notifications from "expo-notifications";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { PushDevice } from "@/api/push";
import type { User } from "@/api/types";
import { secureStorage, storageKeys } from "@/lib/secure-storage";
import { runBeforeSignOut } from "@/lib/session-hooks";
import { PushProvider, usePush } from "./PushContext";

const mockRegisterPushDevice = jest.fn<(...args: unknown[]) => Promise<PushDevice>>();
const mockRemovePushDevice = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockUpdatePushDevice = jest.fn<(...args: unknown[]) => Promise<PushDevice>>();
let mockAuthState: { status: "signedIn"; user: User };

jest.mock("@/api/push", () => ({
  registerPushDevice: (...args: unknown[]) => mockRegisterPushDevice(...args),
  removePushDevice: (...args: unknown[]) => mockRemovePushDevice(...args),
  updatePushDevice: (...args: unknown[]) => mockUpdatePushDevice(...args),
}));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuthState }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    easConfig: { projectId: "project-id" },
    expoConfig: { extra: { eas: { projectId: "project-id" } }, version: "1.0.0" },
  },
}));
jest.mock("expo-device", () => ({ isDevice: true, modelName: "iPhone" }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const user = (id: string): User => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  email: `${id}@example.com`,
  emailVerified: true,
  id,
  name: id,
});

const device = {
  appVersion: "1.0.0",
  createdAt: "2026-01-01T00:00:00.000Z",
  deviceName: "iPhone",
  enabled: true,
  id: "pd_a",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  platform: "ios" as const,
  tokenSuffix: "klmnop",
};

function Probe() {
  const push = usePush();
  return <Text>{push.device?.id ?? "none"}</Text>;
}

describe("PushProvider principal transitions", () => {
  beforeEach(() => {
    mockAuthState = { status: "signedIn", user: user("usr_a") };
    mockRegisterPushDevice.mockReset().mockResolvedValue(device);
    mockRemovePushDevice.mockReset().mockResolvedValue(undefined);
    mockUpdatePushDevice.mockReset();
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      canAskAgain: true,
      expires: "never",
      granted: true,
      ios: undefined,
      status: "granted" as Awaited<
        ReturnType<typeof Notifications.getPermissionsAsync>
      >["status"],
    });
    jest.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({
      data: "ExponentPushToken[abcdefghijklmnop]",
      type: "expo",
    });
  });

  afterEach(async () => {
    await secureStorage.deleteItem(storageKeys.pushDevice);
  });

  it("re-registers when user.id changes even though eligibility stays true", async () => {
    const view = await render(
      <PushProvider>
        <Probe />
      </PushProvider>,
    );
    await waitFor(() => expect(mockRegisterPushDevice).toHaveBeenCalledTimes(1));

    mockAuthState = { status: "signedIn", user: user("usr_b") };
    await view.rerender(
      <PushProvider>
        <Probe />
      </PushProvider>,
    );

    await waitFor(() => expect(mockRegisterPushDevice).toHaveBeenCalledTimes(2));
    await view.unmount();
  });

  it("retains A's device tombstone and rejects a required adoption cleanup on DELETE failure", async () => {
    const view = await render(
      <PushProvider>
        <Probe />
      </PushProvider>,
    );
    await waitFor(() => expect(mockRegisterPushDevice).toHaveBeenCalledTimes(1));
    expect(await secureStorage.getItem(storageKeys.pushDevice)).toBe("pd_a");
    mockRemovePushDevice.mockRejectedValueOnce(new Error("offline"));

    await expect(
      act(async () => runBeforeSignOut({ required: true, timeoutMs: 100 })),
    ).rejects.toThrow("Required principal cleanup failed");

    expect(mockRemovePushDevice).toHaveBeenCalledWith("pd_a");
    expect(await secureStorage.getItem(storageKeys.pushDevice)).toBe("pd_a");
    await view.unmount();
  });
});
