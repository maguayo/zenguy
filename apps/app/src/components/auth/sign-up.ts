import { z } from "zod";
import {
  isAcceptableNewPassword,
  MIN_PASSWORD_LENGTH,
} from "@/lib/password-policy";

export const signUpSchema = z
  .object({
    acceptedTerms: z.boolean().refine(Boolean, "You must accept the Terms and Privacy Policy."),
    confirmPassword: z.string(),
    email: z.string().email("Enter a valid email address."),
    name: z.string().trim().min(1, "Name is required."),
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
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type SignUpValues = z.infer<typeof signUpSchema>;
