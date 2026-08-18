import { sha256Hex } from "../../shared/crypto";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { ResendVerification } from "./resend_verification";

describe("ResendVerification", () => {
  it("quietly succeeds without sending for an unknown email", async () => {
    const dependencies = authTestDependencies();

    await expect(
      new ResendVerification(dependencies).execute({
        email: "unknown@example.com",
      }),
    ).resolves.toEqual({ sent: true });
    expect(dependencies.emailSender.messages).toHaveLength(0);
    expect(dependencies.emailTokens.tokens).toHaveLength(0);
  });

  it("replaces old tokens and sends a new link for an unverified user", async () => {
    const dependencies = authTestDependencies();
    const user = testUser();
    await dependencies.users.insert(user);
    await dependencies.emailTokens.insert({
      id: "tok_old",
      userId: user.id,
      type: "VERIFY_EMAIL",
      tokenHash: await sha256Hex("old"),
      expiresAt: dependencies.clock.now() + 1_000,
      usedAt: null,
      createdAt: dependencies.clock.now(),
    });

    await expect(
      new ResendVerification(dependencies).execute({ email: user.email }),
    ).resolves.toEqual({ sent: true });
    expect(dependencies.emailTokens.tokens).toHaveLength(1);
    expect(dependencies.emailTokens.tokens.has("tok_old")).toBe(false);
    expect(dependencies.emailSender.messages).toHaveLength(1);
    expect(dependencies.emailSender.messages[0]?.to).toEqual([user.email]);
  });

  it("does not send another link to a verified user", async () => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(testUser({ emailVerifiedAt: 1 }));

    await expect(
      new ResendVerification(dependencies).execute({
        email: "ALICE@EXAMPLE.COM",
      }),
    ).resolves.toEqual({ sent: true });
    expect(dependencies.emailSender.messages).toHaveLength(0);
  });
});
