import {
  renderBasicEmail,
  renderInvitationEmail,
  renderRegistrationAttemptEmail,
  renderResetPasswordEmail,
  renderVerifyEmail,
  renderWelcomeEmail,
} from "./templates";

describe("email templates", () => {
  it("renders a CTA in HTML and text when provided", () => {
    const result = renderBasicEmail({
      title: "A title",
      bodyLines: ["First line", "Second line"],
      ctaLabel: "Take action",
      ctaUrl: "https://example.com/action?a=1&b=2",
    });

    expect(result.html).toContain("max-width:600px");
    expect(result.html).toContain("#4f46e5");
    expect(result.html).toContain("Take action&nbsp;&nbsp;→</a>");
    expect(result.html).toContain(
      'href="https://example.com/action?a=1&amp;b=2"',
    );
    expect(result.text).toContain("A title\n\nFirst line\nSecond line");
    expect(result.text).toContain("https://example.com/action?a=1&b=2");
  });

  it("escapes user-controlled HTML", () => {
    const result = renderBasicEmail({
      title: "<Title>",
      bodyLines: ['Hello <script>alert("x")</script>'],
    });

    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;Title&gt;");
  });

  it("renders the branded welcome and verification email", () => {
    const welcome = renderWelcomeEmail(
      "https://app.zenguy.example/",
      "Ana & <Team>",
      "token +/",
    );

    expect(welcome.subject).toBe("Welcome to Zenguy — verify your email");
    expect(welcome.html).toContain("<!doctype html>");
    expect(welcome.html).toContain("Welcome, Ana &amp; &lt;Team&gt;.");
    expect(welcome.html).toContain("YOUR LAUNCH PLAN");
    expect(welcome.html).toContain("300 browser-test runs every month");
    expect(welcome.html).toContain("Unlimited uptime checks");
    expect(welcome.html).toContain("Unlimited team members");
    expect(welcome.html).toContain("No card required.");
    expect(welcome.html).toContain("role=\"presentation\"");
    expect(welcome.html).not.toContain("<Team>");
    expect(welcome.text).toContain("Welcome to Zenguy, Ana & <Team>.");
    expect(welcome.text).toContain(
      "https://app.zenguy.example/verify-email#token%20%2B%2F",
    );
    expect(welcome.text).toContain(
      "You will be asked for the password chosen during registration.",
    );
    expect(new TextEncoder().encode(welcome.html).byteLength).toBeLessThan(
      30_000,
    );
  });

  it("renders the exact auth subjects, copies, and token URLs", () => {
    const verify = renderVerifyEmail(
      "https://app.zenguy.example/",
      "Ana",
      "token +/",
    );
    const reset = renderResetPasswordEmail(
      "https://app.zenguy.example",
      "reset-token",
    );

    expect(verify.subject).toBe("Verify your email — Zenguy");
    expect(verify.text).toContain(
      "Hi Ana, confirm your email address to start using your Zenguy account.",
    );
    expect(verify.text).toContain(
      "https://app.zenguy.example/verify-email#token%20%2B%2F",
    );
    expect(verify.text).toContain(
      "This link expires in 24 hours. If you didn't create an account, do not continue; ignore this email.",
    );
    expect(reset.subject).toBe("Reset your password — Zenguy");
    expect(reset.html).toContain("Reset password&nbsp;&nbsp;→</a>");
    expect(reset.text).toContain(
      "https://app.zenguy.example/reset-password#reset-token",
    );
    expect(reset.text).toContain(
      "This link expires in 1 hour. If you didn't request this, ignore this email.",
    );
  });

  it("renders a safe existing-account registration notification", () => {
    const attempt = renderRegistrationAttemptEmail(
      "https://app.zenguy.example/",
      "Ana & <Team>",
    );

    expect(attempt.subject).toBe(
      "A registration attempt used your email — Zenguy",
    );
    expect(attempt.html).toContain("Hi Ana &amp; &lt;Team&gt;");
    expect(attempt.html).not.toContain("<Team>");
    expect(attempt.text).toContain("Your account was not changed.");
    expect(attempt.text).toContain("sign in or reset your password");
    expect(attempt.text).toContain("https://app.zenguy.example");
    expect(attempt.text).not.toMatch(/verify-email|#[A-Za-z0-9_-]{16,}/u);
  });

  it("renders the exact workspace invitation copy", () => {
    const invitation = renderInvitationEmail(
      "https://app.zenguy.example/",
      "invite-token",
      "Acme",
      "Alice",
      "ADMIN",
    );

    expect(invitation.subject).toBe("You've been invited to Acme on Zenguy");
    expect(invitation.text).toContain(
      'Alice invited you to join the workspace "Acme" as ADMIN.',
    );
    expect(invitation.text).toContain(
      "https://app.zenguy.example/invitations/accept#invite-token",
    );
    expect(invitation.text).toContain("This invitation expires in 7 days.");
  });
});
