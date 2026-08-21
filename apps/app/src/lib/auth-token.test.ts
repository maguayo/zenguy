import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { clearToken, getToken, onExpiringSoon, setToken } from "./auth-token";

describe("auth token memory store", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-19T10:00:00.000Z"));
    clearToken();
  });

  afterEach(() => {
    clearToken();
    jest.useRealTimers();
  });

  it("keeps the token and expiry in memory", () => {
    setToken("access", 1_800);

    expect(getToken()).toEqual({
      accessToken: "access",
      expiresAt: Date.now() + 1_800_000,
    });
  });

  it("fires once sixty seconds before expiry and reschedules", () => {
    const callback = jest.fn();
    const unsubscribe = onExpiringSoon(callback);
    setToken("first", 120);
    jest.advanceTimersByTime(59_999);
    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    setToken("second", 180);
    jest.advanceTimersByTime(120_000);
    expect(callback).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("cancels proactive refresh when cleared", () => {
    const callback = jest.fn();
    const unsubscribe = onExpiringSoon(callback);
    setToken("access", 120);
    clearToken();
    jest.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
    unsubscribe();
  });
});
