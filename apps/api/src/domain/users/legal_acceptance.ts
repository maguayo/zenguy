export interface LegalAcceptance {
  userId: string;
  termsAcceptedAt: number;
  privacyAcknowledgedAt: number;
  marketingOptInAt: number | null;
  legalVersion: string;
  createdAt: number;
}

export interface LegalAcceptanceRepo {
  insert(row: LegalAcceptance): Promise<void>;
}
