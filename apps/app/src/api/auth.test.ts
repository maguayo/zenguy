import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as SecureStore from "expo-secure-store";

import { clearSession, hasStoredSession } from "@/lib/api";
import { getToken } from "@/lib/auth-token";
import { secureStorage, storageKeys } from "@/lib/secure-storage";

import { SessionStorageError, register, verifyEmail } from "./auth";
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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

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

  it("keeps the session handed out by registration", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(nativeSession, 201));

    const session = await register("María", user.email, "Password123!");

    expect(session.user).toEqual(user);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8787/api/auth/register");
    expect(getToken().accessToken).toBe("access-1");
    expect(await secureStorage.getItem(storageKeys.refreshToken)).toBe("refresh-1");
  });

  it("keeps the session handed out by email verification", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...nativeSession, user: { ...user, emailVerified: true }, verified: true }),
    );

    const session = await verifyEmail("token");

    expect(session.user.emailVerified).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:8787/api/auth/verify-email");
    expect(new Headers(init?.headers).get("X-Zenguy-Client")).toBe("native");
    expect(getToken().accessToken).toBe("access-1");
    expect(await hasStoredSession()).toBe(true);
  });

  it("never keeps a half-stored session when the Keychain rejects it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...nativeSession, verified: true }));
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("entitlement missing"));

    await expect(verifyEmail("token")).rejects.toBeInstanceOf(SessionStorageError);

    expect(getToken().accessToken).toBeNull();
    expect(await hasStoredSession()).toBe(false);
  });
});
