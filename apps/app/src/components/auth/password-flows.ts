import { z } from "zod";

import { ApiError } from "@/lib/api";
import { parseLinkToken } from "@/lib/links";
import { isExpiredLink } from "./link-errors";
import {
  isAcceptableNewPassword,
  MIN_PASSWORD_LENGTH,
} from "@/lib/password-policy";

export const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

const passwordFields = {
  confirmPassword: z.string(),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
    .refine(
      isAcceptableNewPassword,
      "Choose a password that is not commonly compromised.",
    ),
};

const passwordsMatch = (values: { confirmPassword: string; password: string }) =>
  values.password === values.confirmPassword;
const passwordsMatchIssue = { message: "Passwords don't match.", path: ["confirmPassword"] };

export const resetPasswordSchema = z.object(passwordFields).refine(passwordsMatch, passwordsMatchIssue);

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const resetTokenMessage = "Paste the token from your password reset email.";

/**
 * The in-app reset form also carries the token: it comes from the deep link
 * when there is one, otherwise the user pastes it from the email link.
 */
export const resetPasswordFormSchema = z
  .object({
    ...passwordFields,
    token: z.string().refine((value) => parseLinkToken(value) !== null, resetTokenMessage),
  })
  .refine(passwordsMatch, passwordsMatchIssue);

export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

/**
 * Like the web, GONE means the link expired. A 400 about the token (rather
 * than the new password) is presented the same way.
 */
export function isResetLinkExpired(error: unknown): boolean {
  if (isExpiredLink(error)) return true;
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    !error.details?.some((detail) => detail.field === "password")
  );
}
