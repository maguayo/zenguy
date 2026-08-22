import { describe, expect, it, vi } from "vitest";

import { createTokenVerifier } from "./VerifyEmail";

describe("email verification single-flight", () => {
  it("shares the request when Strict Mode runs the effect twice", async () => {
    const verify = vi.fn(async () => ({ verified: true }));
    const verifyOnce = createTokenVerifier(verify);

    await Promise.all([verifyOnce("token"), verifyOnce("token")]);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("token");
  });

  it("hands the verification result to every caller", async () => {
    const session = { accessToken: "verify-token", verified: true };
    const verifyOnce = createTokenVerifier(vi.fn(async () => session));

    await expect(verifyOnce("token")).resolves.toEqual(session);
    await expect(verifyOnce("token")).resolves.toEqual(session);
  });

  it("allows a retry after a failed request", async () => {
    const verify = vi
      .fn<(token: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ verified: true });
    const verifyOnce = createTokenVerifier(verify);

    await expect(verifyOnce("token")).rejects.toThrow("offline");
    await expect(verifyOnce("token")).resolves.toEqual({ verified: true });

    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("keeps a successful result so a re-mount never resends a used token", async () => {
    const verify = vi.fn(async () => ({ verified: true }));
    const verifyOnce = createTokenVerifier(verify);

    await verifyOnce("token");
    await verifyOnce("token");
    await verifyOnce("other");

    expect(verify).toHaveBeenCalledTimes(2);
  });
});
