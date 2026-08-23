let pendingRegistrationEmail: string | null = null;

/**
 * Keeps the non-secret resend address only for this process. Registration
 * never writes it to Keychain/AsyncStorage or puts it in a deep-link URL.
 */
export function setPendingRegistrationEmail(email: string): void {
  pendingRegistrationEmail = email.trim().toLowerCase();
}

export function getPendingRegistrationEmail(): string | null {
  return pendingRegistrationEmail;
}

export function clearPendingRegistrationEmail(): void {
  pendingRegistrationEmail = null;
}
