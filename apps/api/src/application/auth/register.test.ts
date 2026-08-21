import { EMAIL_VERIFY_TTL_HOURS } from "../../shared/constants";
import { sha256Hex, verifyPassword } from "../../shared/crypto";
import { authTestDependencies } from "../../test/fakes/auth";
import { RecordingEmailSender } from "../../test/fakes/email";
import { Register } from "./register";

describe("Register", () => {
  it("creates a normalized user and sends a hashed verification token", async () => {
    const dependencies = authTestDependencies();
    const useCase = new Register(dependencies);

    const user = await useCase.execute({
      name: "  Alice  ",
      email: "  Alice@Example.COM ",
      password: "strong-password",
    });

    expect(user).toMatchObject({
      name: "Alice",
      email: "alice@example.com",
      emailVerifiedAt: null,
      createdAt: dependencies.clock.now(),
      updatedAt: dependencies.clock.now(),
    });
    await expect(verifyPassword("strong-password", user.passwordHash)).resolves.toBe(
      true,
    );
    await expect(dependencies.users.findById(user.id)).resolves.toEqual(user);
    expect(dependencies.emailSender.messages).toHaveLength(1);
    const message = dependencies.emailSender.messages[0];
    expect(message?.to).toEqual([user.email]);
    expect(message?.subject).toBe("Welcome to Zenguy — verify your email");
    expect(message?.html).toContain("Welcome, Alice.");
    expect(message?.html).toContain("YOUR LAUNCH PLAN");
    expect(message?.text).toContain("No card required.");

    const tokenPlain = new URL(
      message?.text.match(/https:\/\/\S+/u)?.[0] ?? "invalid:",
    ).searchParams.get("token");
    expect(tokenPlain).not.toBeNull();
    const storedToken = [...dependencies.emailTokens.tokens.values()][0];
    expect(storedToken).toMatchObject({
      userId: user.id,
      type: "VERIFY_EMAIL",
      expiresAt:
        dependencies.clock.now() + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1_000,
      usedAt: null,
    });
    await expect(sha256Hex(tokenPlain ?? "")).resolves.toBe(
      storedToken?.tokenHash,
    );
    expect(storedToken?.tokenHash).not.toBe(tokenPlain);
  });

  it("rejects a duplicate email without creating a token or sending", async () => {
    const dependencies = authTestDependencies();
    const useCase = new Register(dependencies);
    await useCase.execute({
      name: "Alice",
      email: "alice@example.com",
      password: "password-one",
    });
    dependencies.emailSender.messages.length = 0;

    await expect(
      useCase.execute({
        name: "Other",
        email: "ALICE@EXAMPLE.COM",
        password: "password-two",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "An account with this email already exists",
    });
    expect(dependencies.emailTokens.tokens).toHaveLength(1);
    expect(dependencies.emailSender.messages).toHaveLength(0);
  });

  it("keeps registration successful if email delivery fails", async () => {
    const dependencies = authTestDependencies();
    dependencies.emailSender = new RecordingEmailSender(new Error("offline"));
    const useCase = new Register(dependencies);

    await expect(
      useCase.execute({
        name: "Alice",
        email: "alice@example.com",
        password: "password-one",
      }),
    ).resolves.toMatchObject({ email: "alice@example.com" });
  });

  it("validates trimmed name and password boundaries", async () => {
    const useCase = new Register(authTestDependencies());

    await expect(
      useCase.execute({ name: "  ", email: "x@example.com", password: "short" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
