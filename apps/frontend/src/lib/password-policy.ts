const compromised = new Set([
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

// Fast client-side guidance only. The API owns the pinned 100k-entry corpus
// and remains authoritative for registration and password reset.
export const MIN_PASSWORD_LENGTH = 15;

export function isAcceptableNewPassword(password: string): boolean {
  return !compromised.has(password.normalize("NFKC").toLowerCase());
}
