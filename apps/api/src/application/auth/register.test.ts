import { EMAIL_VERIFY_TTL_HOURS } from "../../shared/constants";
import { sha256Hex, verifyPassword } from "../../shared/crypto";
import { FakeTrackEvent } from "../../test/fakes/activity";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { RecordingEmailSender } from "../../test/fakes/email";
import { Register } from "./register";

describe("Register", () => {
  it("creates a normalized user and sends a hashed verification token", async () => {
    const dependencies = authTestDependencies();
    const useCase = new Register(dependencies);

    const pending = await useCase.execute({
      name: "  Alice  ",
      email: "  Alice@Example.COM ",
      password: "strong-password",
      acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
    });

    expect(pending).toEqual({
      registrationPending: true,
      email: "alice@example.com",
    });
    const user = await dependencies.users.findByEmail("alice@example.com");
    expect(user).not.toBeNull();
    await expect(
      verifyPassword("strong-password", user?.passwordHash ?? ""),
    ).resolves.toBe(true);
    expect(dependencies.emailSender.messages).toHaveLength(1);
    const message = dependencies.emailSender.messages[0];
    expect(message?.to).toEqual([user?.email]);
    expect(message?.subject).toBe("Welcome to Zenguy — verify your email");
    expect(message?.html).toContain("Welcome, Alice.");
    expect(message?.html).toContain("YOUR ZENGUY PLAN");
    expect(message?.text).toContain("activate it securely with Stripe");

    const tokenPlain = new URL(
      message?.text.match(/https:\/\/\S+/u)?.[0] ?? "invalid:",
    ).hash.slice(1) || null;
    expect(tokenPlain).not.toBeNull();
    const storedToken = [...dependencies.emailTokens.tokens.values()][0];
    expect(storedToken).toMatchObject({
      userId: user?.id,
      type: "VERIFY_EMAIL",
      expiresAt:
        dependencies.clock.now() + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1_000,
      usedAt: null,
    });
    await expect(sha256Hex(tokenPlain ?? "")).resolves.toBe(
      storedToken?.tokenHash,
    );
    expect(storedToken?.tokenHash).not.toBe(tokenPlain);
    expect([...dependencies.legalAcceptances.rows.values()]).toEqual([
      expect.objectContaining({
        userId: user?.id,
        legalVersion: "2026-08-27",
        marketingOptInAt: null,
      }),
    ]);
  });

  it("returns no credentials or persisted session until the inbox is verified", async () => {
    const dependencies = authTestDependencies();

    const session = await new Register(dependencies).execute({
      name: "Alice",
      email: "alice@example.com",
      password: "strong-password",
      acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
    });

    expect(session).toEqual({
      registrationPending: true,
      email: "alice@example.com",
    });
    expect(session).not.toHaveProperty("accessToken");
    expect(session).not.toHaveProperty("refreshTokenPlain");
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
  });

  it("gives duplicate emails an indistinguishable pending response and notifies the owner", async () => {
    const dependencies = authTestDependencies();
    const useCase = new Register(dependencies);
    await useCase.execute({
      name: "Alice",
      email: "alice@example.com",
      password: "unique-password-one",
      acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
    });
    dependencies.emailSender.messages.length = 0;

    const duplicate = await useCase.execute({
        name: "Other",
        email: "ALICE@EXAMPLE.COM",
        password: "unique-password-two",
        acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
      });
    expect(duplicate).toEqual({
      registrationPending: true,
      email: "alice@example.com",
    });
    expect(dependencies.users.users.size).toBe(1);
    expect(dependencies.emailTokens.tokens.size).toBe(1);
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
    expect(dependencies.emailSender.messages).toHaveLength(1);
    expect(dependencies.emailSender.messages[0]?.subject).toBe(
      "A registration attempt used your email — Zenguy",
    );
  });

  it("pays the password KDF before answering for an existing email", async () => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(
      testUser({ email: "existing@example.com" }),
    );
    const passwordHasher = vi.fn(async () => "synthetic-current-password-hash");

    await new Register(dependencies, passwordHasher).execute({
      name: "Other registrant",
      email: "existing@example.com",
      password: "another strong password",
      acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
    });

    expect(passwordHasher).toHaveBeenCalledOnce();
    expect(passwordHasher).toHaveBeenCalledWith("another strong password");
    expect(dependencies.users.users.size).toBe(1);
  });

  it("keeps the same response and owner notification when uniqueness loses a race", async () => {
    const dependencies = authTestDependencies();
    const winner = testUser({
      id: "usr_race_winner",
      name: "Existing owner",
      email: "race@example.com",
    });
    vi.spyOn(dependencies.users, "insertIfAbsent").mockImplementationOnce(
      async () => {
        await dependencies.users.insert(winner);
        return false;
      },
    );

    const response = await new Register(dependencies).execute({
      name: "Other registrant",
      email: "RACE@EXAMPLE.COM",
      password: "another strong password",
      acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
    });

    expect(response).toEqual({
      registrationPending: true,
      email: "race@example.com",
    });
    expect(dependencies.users.users.size).toBe(1);
    expect(dependencies.emailTokens.tokens.size).toBe(0);
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
    expect(dependencies.emailSender.messages).toHaveLength(1);
    expect(dependencies.emailSender.messages[0]).toMatchObject({
      to: [winner.email],
      subject: "A registration attempt used your email — Zenguy",
    });
  });

  it("keeps registration successful if email delivery fails", async () => {
    const dependencies = authTestDependencies();
    dependencies.emailSender = new RecordingEmailSender(new Error("offline"));
    const useCase = new Register(dependencies);

    await expect(
      useCase.execute({
        name: "Alice",
        email: "alice@example.com",
        password: "unique-password-one",
        acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
      }),
    ).resolves.toEqual({
      registrationPending: true,
      email: "alice@example.com",
    });
  });

  it("rejects explicit refusal of the terms or privacy checkboxes", async () => {
    const useCase = new Register(authTestDependencies());

    await expect(
      useCase.execute({
        name: "Alice",
        email: "alice@example.com",
        password: "strong-password",
        acceptedPrivacy: false,
        acceptedTerms: false,
        marketingOptIn: false,
        client: "web",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.arrayContaining([
        { field: "acceptedTerms", message: "You must accept the Terms of Service." },
        {
          field: "acceptedPrivacy",
          message: "You must confirm that you have read the Privacy Policy.",
        },
      ]),
    });
  });

  it("validates trimmed name and password boundaries", async () => {
    const useCase = new Register(authTestDependencies());

    await expect(
      useCase.execute({
        name: "  ",
        email: "x@example.com",
        password: "short",
        acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("enforces the new-password policy inside the use case", async () => {
    const useCase = new Register(authTestDependencies());

    await expect(
      useCase.execute({
        name: "Alice",
        email: "short@example.com",
        password: "12345678901234",
        acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      useCase.execute({
        name: "Alice",
        email: "known@example.com",
        password: "passwordpassword",
        acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("records user.registered for a brand-new email", async () => {
    const track = new FakeTrackEvent();
    const dependencies = { ...authTestDependencies(), track };

    await new Register(dependencies).execute({
      name: "Alice",
      email: "alice@example.com",
      password: "strong-password",
      acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
    });

    const user = await dependencies.users.findByEmail("alice@example.com");
    expect(user).not.toBeNull();
    expect(track.calls).toEqual([
      { type: "user.registered", userId: user?.id, source: "web" },
    ]);
  });

  it("records nothing when the email already exists", async () => {
    const track = new FakeTrackEvent();
    const useCase = new Register({ ...authTestDependencies(), track });
    await useCase.execute({
      name: "Alice",
      email: "alice@example.com",
      password: "unique-password-one",
      acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "web",
    });
    track.calls.length = 0;

    await useCase.execute({
      name: "Other",
      email: "ALICE@EXAMPLE.COM",
      password: "unique-password-two",
      acceptedPrivacy: true,
      acceptedTerms: true,
      marketingOptIn: false,
      client: "app",
    });

    expect(track.calls).toEqual([]);
  });
});
