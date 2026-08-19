import {
  renderBasicEmail,
  renderInvitationEmail,
  renderResetPasswordEmail,
  renderVerifyEmail,
} from "./templates";

describe("email templates", () => {
  it("renders a CTA in HTML and text when provided", () => {
    const result = renderBasicEmail({
      title: "A title",
      bodyLines: ["First line", "Second line"],
      ctaLabel: "Take action",
      ctaUrl: "https://example.com/action?a=1&b=2",
    });

    expect(result.html).toContain("width=\"560\"");
    expect(result.html).toContain("#4F46E5");
    expect(result.html).toContain(">Take action</a>");
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
    expect(verify.text).toContain("Welcome to Zenguy, Ana.");
    expect(verify.text).toContain(
      "Confirm your email address to start using your account.",
    );
    expect(verify.text).toContain(
      "https://app.zenguy.example/verify-email?token=token%20%2B%2F",
    );
    expect(verify.text).toContain(
      "This link expires in 24 hours. If you didn't create an account, ignore this email.",
    );
    expect(reset.subject).toBe("Reset your password — Zenguy");
    expect(reset.html).toContain(">Reset password</a>");
    expect(reset.text).toContain(
      "https://app.zenguy.example/reset-password?token=reset-token",
    );
    expect(reset.text).toContain(
      "This link expires in 1 hour. If you didn't request this, ignore this email.",
    );
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
      "https://app.zenguy.example/invitations/invite-token",
    );
    expect(invitation.text).toContain("This invitation expires in 7 days.");
  });
});
