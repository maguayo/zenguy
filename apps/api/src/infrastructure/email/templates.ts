import type { EmailMessage } from "../../domain/email/sender";

export interface BasicEmailInput {
  title: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
}

interface EmailFrameInput {
  preheader: string;
  eyebrow: string;
  title: string;
  trustedContentHtml: string;
  ctaLabel?: string;
  ctaNote?: string;
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

function renderEmailFrame(input: EmailFrameInput): string {
  const ctaNote =
    input.ctaNote === undefined
      ? ""
      : `<p style="margin:20px 0 0;color:#71717a;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px">${escapeHtml(input.ctaNote)}</p>`;
  const cta =
    input.ctaLabel !== undefined && input.ctaUrl !== undefined
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0">
  <tr>
    <td bgcolor="#4f46e5" style="border-radius:7px">
      <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;padding:14px 22px;border:1px solid #4f46e5;border-radius:7px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:18px;text-decoration:none">${escapeHtml(input.ctaLabel)}&nbsp;&nbsp;→</a>
    </td>
  </tr>
</table>
${ctaNote}
<p style="margin:18px 0 0;color:#71717a;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px">
  Button not working? Copy and paste this link:<br>
  <a href="${escapeHtml(input.ctaUrl)}" style="color:#4338ca;text-decoration:underline;word-break:break-all">${escapeHtml(input.ctaUrl)}</a>
</p>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${escapeHtml(input.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f5" style="width:100%;background:#f4f4f5">
    <tr>
      <td align="center" style="padding:32px 12px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
          <tr>
            <td bgcolor="#18181b" style="padding:22px 28px;border-radius:12px 12px 0 0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.5px">zenguy<span style="color:#818cf8">.</span></td>
                  <td align="right" style="color:#a1a1aa;font-family:'Courier New',Courier,monospace;font-size:10px;font-weight:700;letter-spacing:1.4px">STAY ZEN.</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:38px 38px 36px;border-right:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;border-left:1px solid #e4e4e7;border-radius:0 0 12px 12px">
              <p style="margin:0 0 12px;color:#4f46e5;font-family:'Courier New',Courier,monospace;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${escapeHtml(input.eyebrow)}</p>
              <h1 style="margin:0;color:#18181b;font-family:Georgia,'Times New Roman',serif;font-size:34px;font-style:italic;font-weight:400;letter-spacing:-0.7px;line-height:40px">${escapeHtml(input.title)}</h1>
              <div style="margin-top:22px;color:#3f3f46;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px">${input.trustedContentHtml}</div>
              ${cta}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 20px 0;color:#71717a;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px">
              Zenguy · Automated browser tests and uptime monitoring<br>
              <a href="https://zenguy.com" style="color:#52525b;text-decoration:underline">zenguy.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function basicText(input: BasicEmailInput): string {
  const textParts = [input.title, "", ...input.bodyLines];
  if (input.ctaUrl !== undefined) textParts.push("", input.ctaUrl);
  textParts.push("", "Zenguy — Automated browser tests and uptime monitoring");
  return textParts.join("\n");
}

export function renderBasicEmail(input: BasicEmailInput): {
  html: string;
  text: string;
} {
  const contentHtml = input.bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 16px;line-height:24px">${escapeHtml(line)}</p>`,
    )
    .join("");
  const html = renderEmailFrame({
    preheader: input.bodyLines[0] ?? input.title,
    eyebrow: "Zenguy account",
    title: input.title,
    trustedContentHtml: contentHtml,
    ctaLabel: input.ctaLabel,
    ctaUrl: input.ctaUrl,
  });

  return { html, text: basicText(input) };
}

function authUrl(appUrl: string, path: string, token: string): string {
  // Fragments reach the SPA / Universal Link handler but are never sent in an
  // HTTP request or Referer. The client removes the fragment before use.
  return `${appUrl.replace(/\/$/, "")}/${path}#${encodeURIComponent(token)}`;
}

export function renderWelcomeEmail(
  appUrl: string,
  name: string,
  token: string,
): Omit<EmailMessage, "to"> {
  const verifyUrl = authUrl(appUrl, "verify-email", token);
  const subject = "Welcome to Zenguy — verify your email";
  const contentHtml = `<p style="margin:0 0 18px">Your Zenguy account is ready. Confirm your email to start monitoring the journeys and endpoints your business depends on.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8fafc" style="width:100%;margin:22px 0 0;background:#f8fafc;border:1px solid #e4e4e7;border-radius:8px">
  <tr><td style="padding:18px 20px 8px;color:#52525b;font-family:'Courier New',Courier,monospace;font-size:10px;font-weight:700;letter-spacing:1.2px">YOUR ZENGUY PLAN</td></tr>
  <tr><td style="padding:6px 20px;color:#27272a;font-size:14px;line-height:21px"><span style="color:#059669;font-weight:700">✓</span>&nbsp;&nbsp;39 € per month, per workspace</td></tr>
  <tr><td style="padding:6px 20px;color:#27272a;font-size:14px;line-height:21px"><span style="color:#059669;font-weight:700">✓</span>&nbsp;&nbsp;300 browser-test runs every month</td></tr>
  <tr><td style="padding:6px 20px;color:#27272a;font-size:14px;line-height:21px"><span style="color:#059669;font-weight:700">✓</span>&nbsp;&nbsp;Unlimited uptime checks</td></tr>
  <tr><td style="padding:6px 20px 18px;color:#27272a;font-size:14px;line-height:21px"><span style="color:#059669;font-weight:700">✓</span>&nbsp;&nbsp;Unlimited team members</td></tr>
</table>
<p style="margin:18px 0 0;padding:12px 14px;background:#eef2ff;border-left:3px solid #4f46e5;border-radius:4px;color:#3730a3;font-size:13px;line-height:20px">After verification, create a workspace and activate it securely with Stripe. Billing starts only after you confirm Checkout.</p>`;
  const html = renderEmailFrame({
    preheader: "Open the link and enter your registration password to verify your email.",
    eyebrow: "Welcome to Zenguy",
    title: `Welcome, ${name}.`,
    trustedContentHtml: contentHtml,
    ctaLabel: "Verify my email",
    ctaNote:
      "You will be asked for the password chosen during registration. This secure link expires in 24 hours. If you didn't create this account, do not continue; you can safely ignore this email.",
    ctaUrl: verifyUrl,
  });
  const text = [
    `Welcome to Zenguy, ${name}.`,
    "",
    "Your Zenguy account is ready. Confirm your email to start monitoring the journeys and endpoints your business depends on.",
    "",
    "Your Zenguy plan:",
    "- 39 € per month, per workspace",
    "- 300 browser-test runs every month",
    "- Unlimited uptime checks",
    "- Unlimited team members",
    "",
    "After verification, create a workspace and activate it securely with Stripe. Billing starts only after you confirm Checkout.",
    "",
    "Verify my email:",
    verifyUrl,
    "",
    "You will be asked for the password chosen during registration. This secure link expires in 24 hours. If you didn't create this account, do not continue; you can safely ignore this email.",
    "",
    "Zenguy — Automated browser tests and uptime monitoring",
  ].join("\n");

  return { subject, html, text };
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
      `Hi ${name}, confirm your email address to start using your Zenguy account.`,
      "You will be asked for the password chosen during registration. This link expires in 24 hours. If you didn't create an account, do not continue; ignore this email.",
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

export function renderRegistrationAttemptEmail(
  appUrl: string,
  name: string,
): Omit<EmailMessage, "to"> {
  const subject = "A registration attempt used your email — Zenguy";
  const rendered = renderBasicEmail({
    title: "Your Zenguy account already exists",
    bodyLines: [
      `Hi ${name}, someone tried to register a new Zenguy account with this email address.`,
      "Your account was not changed. If this was you, sign in or reset your password; otherwise you can ignore this message.",
    ],
    ctaLabel: "Open Zenguy",
    ctaUrl: appUrl.replace(/\/$/u, ""),
  });
  return { subject, ...rendered };
}

export function renderInvitationEmail(
  appUrl: string,
  token: string,
  workspaceName: string,
  inviterName: string,
  role: "ADMIN" | "MEMBER",
): Omit<EmailMessage, "to"> {
  const subject = `You've been invited to ${workspaceName} on Zenguy`;
  const rendered = renderBasicEmail({
    title: "You've been invited to Zenguy",
    bodyLines: [
      `${inviterName} invited you to join the workspace "${workspaceName}" as ${role}.`,
      "This invitation expires in 7 days.",
    ],
    ctaLabel: "Accept invitation",
    ctaUrl: `${appUrl.replace(/\/$/, "")}/invitations/accept#${encodeURIComponent(token)}`,
  });
  return { subject, ...rendered };
}
