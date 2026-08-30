import { describe, expect, it, vi } from "vitest";

import {
  adoptVerifiedEmailSession,
  verificationEmailSchema,
  verificationPasswordSchema,
} from "./VerifyEmail";

describe("email verification forms", () => {
  it("requires the original registration password", () => {
    expect(verificationPasswordSchema.safeParse({ password: "" }).success).toBe(
      false,
    );
    expect(
      verificationPasswordSchema.safeParse({ password: "historic password" })
        .success,
    ).toBe(true);
  });

  it("still validates the resend address separately", () => {
    expect(verificationEmailSchema.safeParse({ email: "invalid" }).success).toBe(
      false,
    );
    expect(
      verificationEmailSchema.safeParse({ email: "alice@example.com" }).success,
    ).toBe(true);
  });

  it("adopts the genuinely verified session before tracking sign_up", async () => {
    const order: string[] = [];
    const adoptSession = vi.fn(async () => {
      order.push("adopt");
    });
    const trackSignUp = vi.fn(async () => {
      order.push("track");
      return true;
    });
    const session = {
      accessToken: "access-token-kept-out-of-analytics",
      expiresIn: 900,
      user: {
        createdAt: "2026-08-30T10:00:00.000Z",
        email: "alice@example.com",
        emailVerified: true,
        id: "usr_01j00000000000000000000000",
        name: "Alice",
      },
    };

    await adoptVerifiedEmailSession(session, adoptSession, trackSignUp);

    expect(order).toEqual(["adopt", "track"]);
    expect(trackSignUp).toHaveBeenCalledWith(session.user);
  });
});
