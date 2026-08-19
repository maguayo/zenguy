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

  it("allows a retry after a failed request", async () => {
    const verify = vi
      .fn<(token: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ verified: true });
    const verifyOnce = createTokenVerifier(verify);

    await expect(verifyOnce("token")).rejects.toThrow("offline");
    await expect(verifyOnce("token")).resolves.toBeUndefined();

    expect(verify).toHaveBeenCalledTimes(2);
  });
});
