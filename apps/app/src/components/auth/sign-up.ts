import { z } from "zod";

export const signUpSchema = z
  .object({
    acceptedTerms: z.boolean().refine(Boolean, "You must accept the Terms and Privacy Policy."),
    confirmPassword: z.string(),
    email: z.string().email("Enter a valid email address."),
    name: z.string().trim().min(1, "Name is required."),
    password: z.string().min(8, "Password must be at least 8 characters."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type SignUpValues = z.infer<typeof signUpSchema>;
