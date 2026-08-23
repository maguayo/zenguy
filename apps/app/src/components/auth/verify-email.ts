import { z } from "zod";

export const verificationEmailSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});
export const verificationPasswordSchema = z.object({
  password: z
    .string()
    .min(1, "Enter the password used to create this account."),
});

export type VerificationEmailValues = z.infer<typeof verificationEmailSchema>;
export type VerificationPasswordValues = z.infer<
  typeof verificationPasswordSchema
>;

export type VerificationState =
  | "ready"
  | "error"
  | "gone"
  | "loading"
  | "success";
