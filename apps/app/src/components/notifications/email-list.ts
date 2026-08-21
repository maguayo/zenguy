import { z } from "zod";

const emailSchema = z.email();

export interface AddEmailsResult {
  emails: string[];
  error: string | null;
}

/** Splits a comma-separated draft into normalised, de-duplicated addresses. */
export function addEmails(current: string[], input: string, max = 10): AddEmailsResult {
  const candidates = input
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (candidates.length === 0) return { emails: current, error: null };

  const invalid = candidates.find((email) => !emailSchema.safeParse(email).success);
  if (invalid) return { emails: current, error: `“${invalid}” is not a valid email address.` };

  const unique = [...current];
  for (const candidate of candidates) {
    if (!unique.some((email) => email.toLowerCase() === candidate)) unique.push(candidate);
  }
  if (unique.length > max) {
    return { emails: current, error: `You can add up to ${max} email addresses.` };
  }
  return { emails: unique, error: null };
}

export function removeEmail(current: string[], email: string): string[] {
  return current.filter((item) => item !== email);
}
