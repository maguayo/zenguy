import { LEGAL_VERSION } from "../../shared/constants";
import { freshDb, testEnv } from "../../test/helpers";
import { D1LegalAcceptanceRepo } from "./legal_acceptance_repo";

describe("D1LegalAcceptanceRepo", () => {
  it("stores terms, privacy and marketing timestamps", async () => {
    await freshDb();
    const repo = new D1LegalAcceptanceRepo(testEnv().DB);
    await repo.insert({
      userId: "usr_legal",
      termsAcceptedAt: 10,
      privacyAcknowledgedAt: 10,
      marketingOptInAt: 11,
      legalVersion: LEGAL_VERSION,
      createdAt: 10,
    });
    const row = await testEnv()
      .DB.prepare("SELECT * FROM user_legal_acceptances WHERE user_id = ?")
      .bind("usr_legal")
      .first();
    expect(row).toMatchObject({
      user_id: "usr_legal",
      legal_version: LEGAL_VERSION,
      marketing_opt_in_at: 11,
    });
  });
});
