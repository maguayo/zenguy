export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** Non-secret correlation headers for provider-side reconciliation. */
  headers?: Record<string, string>;
}

export interface EmailSender {
  send(
    message: EmailMessage,
  ): Promise<{ providerMessageId: string | null }>;
}
