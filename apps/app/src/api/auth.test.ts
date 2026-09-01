import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as SecureStore from "expo-secure-store";

import { clearSession, hasStoredSession, isTerminalLogoutPending } from "@/lib/api";
import { getToken } from "@/lib/auth-token";
import { secureStorage, storageKeys } from "@/lib/secure-storage";

import {
  activateSession,
  logout,
  retryPendingLogout,
  SessionStorageError,
} from "./auth";
import type { User } from "./types";

type FetchMock = jest.Mock<(input: string, init?: RequestInit) => Promise<Response>>;

const user: User = {
  createdAt: "2026-08-23T10:00:00.000Z",
  email: "maria@example.com",
  emailVerified: false,
  id: "usr_1",
  name: "María",
};

const nativeSession = {
  accessToken: "access-1",
  expiresIn: 1_800,
  refreshExpiresIn: 2_592_000,
  refreshToken: "refresh-1",
  user,
};

describe("auth API sessions", () => {
  let fetchMock: FetchMock;

  beforeEach(async () => {
    fetchMock = jest.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    global.fetch = fetchMock as unknown as typeof fetch;
    await clearSession();
  });

  afterEach(async () => {
    await clearSession();
  });

  it("never keeps a half-stored session when the Keychain rejects it", async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("entitlement missing"));

    await expect(activateSession(nativeSession)).rejects.toBeInstanceOf(SessionStorageError);

    expect(getToken().accessToken).toBeNull();
    expect(await hasStoredSession()).toBe(false);
  });

  it("keeps a terminal tombstone and retries server revocation after offline logout", async () => {
    await activateSession(nativeSession);
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));

    await expect(logout()).rejects.toThrow("Network request failed");
    expect(getToken().accessToken).toBeNull();
    expect(await hasStoredSession()).toBe(false);
    expect(await isTerminalLogoutPending()).toBe(true);
    expect(await secureStorage.getItem(storageKeys.refreshToken)).toBe("refresh-1");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await retryPendingLogout();
    expect(await isTerminalLogoutPending()).toBe(false);
    expect(await secureStorage.getItem(storageKeys.refreshToken)).toBeNull();
  });
});
