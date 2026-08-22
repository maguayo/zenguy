import { describe, expect, it, jest } from "@jest/globals";

import { createTokenVerifier } from "./verify-email";

describe("email verification single-flight", () => {
  it("shares the request when the effect runs twice", async () => {
    const verify = jest.fn(async () => ({ verified: true }));
    const verifyOnce = createTokenVerifier(verify);

    await Promise.all([verifyOnce("token"), verifyOnce("token")]);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("token");
  });

  it("allows a retry after a failed request", async () => {
    const verify = jest
      .fn<(token: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ verified: true });
    const verifyOnce = createTokenVerifier(verify);

    await expect(verifyOnce("token")).rejects.toThrow("offline");
    await expect(verifyOnce("token")).resolves.toEqual({ verified: true });

    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("hands the verification result to every caller", async () => {
    const session = { accessToken: "verify-token", verified: true };
    const verifyOnce = createTokenVerifier(jest.fn(async () => session));

    await expect(verifyOnce("token")).resolves.toEqual(session);
    await expect(verifyOnce("token")).resolves.toEqual(session);
  });

  it("keeps a successful result so a re-mount never resends a used token", async () => {
    const verify = jest.fn(async () => ({ verified: true }));
    const verifyOnce = createTokenVerifier(verify);

    await verifyOnce("token");
    await verifyOnce("token");
    await verifyOnce("other");

    expect(verify).toHaveBeenCalledTimes(2);
  });
});
