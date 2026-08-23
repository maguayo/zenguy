import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "./constants";
import { COMPROMISED_PASSWORD_CORPUS } from "./compromised_password_corpus";

// Keep service-specific and modern obvious variants alongside the pinned NCSC
// corpus. The server-side set is authoritative and needs no third-party lookup,
// so password creation remains private and available during provider outages.
const COMPROMISED_PASSWORDS = new Set([
  ...COMPROMISED_PASSWORD_CORPUS,
  "123456789012",
  "administrator",
  "changemechangeme",
  "iloveyouiloveyou",
  "letmeinletmein",
  "passwordpassword",
  "password123!",
  "password1234!",
  "p@ssw0rd1234",
  "qwerty123456!",
  "qwertyqwerty12",
  "welcome123456",
  "zenguyzenguy",
]);

export function isCompromisedPassword(password: string): boolean {
  return COMPROMISED_PASSWORDS.has(password.normalize("NFKC").toLowerCase());
}

export function passwordCodePointLength(password: string): number {
  return [...password.normalize("NFC")].length;
}

export function newPasswordIssues(password: string): string[] {
  const issues: string[] = [];
  // NIST counts Unicode code points, not UTF-16 code units. Normalize for the
  // count so it matches the representation used by the current hash format.
  const length = passwordCodePointLength(password);
  if (length < MIN_PASSWORD_LENGTH) {
    issues.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (length > MAX_PASSWORD_LENGTH) {
    issues.push(`Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`);
  }
  if (isCompromisedPassword(password)) {
    issues.push("Choose a password that is not commonly compromised");
  }
  return issues;
}
