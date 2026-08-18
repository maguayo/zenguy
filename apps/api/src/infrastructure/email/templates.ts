import type { EmailMessage } from "../../domain/email/sender";

export interface BasicEmailInput {
  title: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderBasicEmail(input: BasicEmailInput): {
  html: string;
  text: string;
} {
  const paragraphs = input.bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(line)}</p>`,
    )
    .join("");
  const cta =
    input.ctaLabel !== undefined && input.ctaUrl !== undefined
      ? `<p style="margin:24px 0"><a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${escapeHtml(input.ctaLabel)}</a></p>`
      : "";
  const html = `<table role="presentation" width="560" cellpadding="0" cellspacing="0" align="center" style="width:560px;max-width:100%;margin:0 auto;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111"><tr><td style="padding:32px"><h1 style="margin:0 0 24px;font-size:24px">${escapeHtml(input.title)}</h1>${paragraphs}${cta}<p style="margin:32px 0 0;color:#666;font-size:13px">Zenguy</p></td></tr></table>`;
  const textParts = [input.title, "", ...input.bodyLines];
  if (input.ctaUrl !== undefined) textParts.push("", input.ctaUrl);
  textParts.push("", "Zenguy");

  return { html, text: textParts.join("\n") };
}

function authUrl(appUrl: string, path: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/${path}?token=${encodeURIComponent(token)}`;
}

export function renderVerifyEmail(
  appUrl: string,
  name: string,
  token: string,
): Omit<EmailMessage, "to"> {
  const subject = "Verify your email — Zenguy";
  const rendered = renderBasicEmail({
    title: "Verify your email",
    bodyLines: [
      `Welcome to Zenguy, ${name}.`,
      "Confirm your email address to start using your account.",
      "This link expires in 24 hours. If you didn't create an account, ignore this email.",
    ],
    ctaLabel: "Verify email",
    ctaUrl: authUrl(appUrl, "verify-email", token),
  });
  return { subject, ...rendered };
}

export function renderResetPasswordEmail(
  appUrl: string,
  token: string,
): Omit<EmailMessage, "to"> {
  const subject = "Reset your password — Zenguy";
  const rendered = renderBasicEmail({
    title: "Reset your password",
    bodyLines: [
      "Use the button below to choose a new password.",
      "This link expires in 1 hour. If you didn't request this, ignore this email.",
    ],
    ctaLabel: "Reset password",
    ctaUrl: authUrl(appUrl, "reset-password", token),
  });
  return { subject, ...rendered };
}
