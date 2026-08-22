import { z } from "zod";

export const verificationEmailSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

export type VerificationEmailValues = z.infer<typeof verificationEmailSchema>;

export type VerificationState = "error" | "gone" | "loading" | "success";

/**
 * Verification tokens are single-use: the same token is only ever sent once,
 * even when the screen mounts twice (Strict Mode, re-render after a deep link).
 * A failed request is forgotten so the user can retry; a successful result
 * (the session the API hands out) is kept for every caller.
 */
export function createTokenVerifier<T>(
  verify: (token: string) => Promise<T>,
): (token: string) => Promise<T> {
  const requests = new Map<string, Promise<T>>();
  return (token) => {
    const existing = requests.get(token);
    if (existing) return existing;
    const request = verify(token).catch((error: unknown) => {
      requests.delete(token);
      throw error;
    });
    requests.set(token, request);
    return request;
  };
}
