import type {
  LegalAcceptance,
  LegalAcceptanceRepo,
} from "../../domain/users/legal_acceptance";
import { run } from "./d1";

export class D1LegalAcceptanceRepo implements LegalAcceptanceRepo {
  constructor(private readonly database: D1Database) {}

  async insert(row: LegalAcceptance): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO user_legal_acceptances
            (user_id, terms_accepted_at, privacy_acknowledged_at, marketing_opt_in_at, legal_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.userId,
          row.termsAcceptedAt,
          row.privacyAcknowledgedAt,
          row.marketingOptInAt,
          row.legalVersion,
          row.createdAt,
        ),
    );
  }
}
