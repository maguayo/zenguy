import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToken, getToken, onExpiringSoon, setToken } from "./auth-token";

describe("auth token memory store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T10:00:00.000Z"));
    clearToken();
  });

  afterEach(() => {
    clearToken();
    vi.useRealTimers();
  });

  it("keeps the token and expiry in memory", () => {
    setToken("access", 1_800);

    expect(getToken()).toEqual({
      accessToken: "access",
      expiresAt: Date.now() + 1_800_000,
    });
  });

  it("fires once sixty seconds before expiry and reschedules", () => {
    const callback = vi.fn();
    const unsubscribe = onExpiringSoon(callback);
    setToken("first", 120);
    vi.advanceTimersByTime(59_999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    setToken("second", 180);
    vi.advanceTimersByTime(120_000);
    expect(callback).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("cancels proactive refresh when cleared", () => {
    const callback = vi.fn();
    const unsubscribe = onExpiringSoon(callback);
    setToken("access", 120);
    clearToken();
    vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
    unsubscribe();
  });
});
