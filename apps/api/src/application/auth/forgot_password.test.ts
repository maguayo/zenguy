import { PASSWORD_RESET_TTL_HOURS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { RecordingEmailSender } from "../../test/fakes/email";
import { ForgotPassword } from "./forgot_password";

describe("ForgotPassword", () => {
  it("quietly succeeds without sending for an unknown email", async () => {
    const dependencies = authTestDependencies();

    await expect(
      new ForgotPassword(dependencies).execute({
        email: "unknown@example.com",
      }),
    ).resolves.toEqual({ sent: true });
    expect(dependencies.emailSender.messages).toHaveLength(0);
    expect(dependencies.emailTokens.tokens.size).toBe(0);
  });

  it("replaces old reset tokens and sends a one-hour reset link", async () => {
    const dependencies = authTestDependencies();
    const user = testUser();
    await dependencies.users.insert(user);
    await dependencies.emailTokens.insert({
      id: "tok_old_reset",
      userId: user.id,
      type: "RESET_PASSWORD",
      tokenHash: await sha256Hex("old-reset"),
      expiresAt: dependencies.clock.now() + 1_000,
      usedAt: null,
      createdAt: dependencies.clock.now(),
    });

    await expect(
      new ForgotPassword(dependencies).execute({
        email: " ALICE@EXAMPLE.COM ",
      }),
    ).resolves.toEqual({ sent: true });

    expect(dependencies.emailTokens.tokens.size).toBe(1);
    expect(dependencies.emailTokens.tokens.has("tok_old_reset")).toBe(false);
    const stored = [...dependencies.emailTokens.tokens.values()][0];
    expect(stored).toMatchObject({
      userId: user.id,
      type: "RESET_PASSWORD",
      expiresAt:
        dependencies.clock.now() +
        PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1_000,
    });
    expect(dependencies.emailSender.messages[0]).toMatchObject({
      to: [user.email],
      subject: "Reset your password — Zenguy",
    });
  });

  it("keeps the anti-enumeration response when delivery fails", async () => {
    const dependencies = authTestDependencies();
    dependencies.emailSender = new RecordingEmailSender(new Error("offline"));
    await dependencies.users.insert(testUser());

    await expect(
      new ForgotPassword(dependencies).execute({
        email: "alice@example.com",
      }),
    ).resolves.toEqual({ sent: true });
  });
});
