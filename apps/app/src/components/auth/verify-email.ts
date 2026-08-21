import { z } from "zod";

export const verificationEmailSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

export type VerificationEmailValues = z.infer<typeof verificationEmailSchema>;

export type VerificationState = "error" | "gone" | "loading" | "success";

/**
 * Verification tokens are single-use: the same token is only ever sent once,
 * even when the screen mounts twice (Strict Mode, re-render after a deep link).
 * A failed request is forgotten so the user can retry.
 */
export function createTokenVerifier(
  verify: (token: string) => Promise<unknown>,
): (token: string) => Promise<void> {
  const requests = new Map<string, Promise<void>>();
  return (token) => {
    const existing = requests.get(token);
    if (existing) return existing;
    const request = verify(token)
      .then(() => undefined)
      .catch((error: unknown) => {
        requests.delete(token);
        throw error;
      });
    requests.set(token, request);
    return request;
  };
}
