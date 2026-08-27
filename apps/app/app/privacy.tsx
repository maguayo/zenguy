import {
  LegalContactEmail,
  LegalPage,
  LegalParagraph,
  LegalSection,
} from "@/components/legal/LegalPage";

export default function Privacy() {
  return (
    <LegalPage related={{ href: "/terms", label: "Terms of Service" }} title="Privacy Policy">
      <LegalParagraph>
        NIESAYO GROUP, S.L. (NIF B23920663), Calle Doctor Pi i Molist, 72, 3º 2ª,
        08016 Barcelona, Spain, is the controller for Zenguy. Contact{" "}
        <LegalContactEmail />. You may also complain to the Spanish Data
        Protection Agency (AEPD). The full policy is at zenguy.com/privacy.
      </LegalParagraph>

      <LegalSection title="What we process">
        <LegalParagraph>
          Account and contact data, workspace membership, test and monitor
          configuration, encrypted secrets, run evidence for 30 days, billing
          records via Stripe, security logs, and notification destinations you
          add.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Why">
        <LegalParagraph>
          Account and service data: contract (GDPR art. 6.1.b). Billing and tax:
          legal obligation (art. 6.1.c). Security: legitimate interests (art.
          6.1.f). Product emails: consent, optional, not required to open an
          account. We do not sell personal data.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Your tests">
        <LegalParagraph>
          You are the controller of personal data that appears on the sites you
          ask us to watch. Zenguy is the processor. Avoid unnecessary production
          personal data in tests.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="SMS and phone">
        <LegalParagraph>
          We do not sell mobile numbers or SMS opt-in data, and we do not share
          them with third parties for their marketing. Alerts go only to numbers
          you enrol after an explicit checkbox. Reply STOP to opt out or HELP
          for help. Consent to SMS is not a condition of purchase.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Providers, transfers and rights">
        <LegalParagraph>
          Cloudflare, Stripe, Twilio, OpenAI and Expo help operate Zenguy. Some
          processing is outside the EEA under Standard Contractual Clauses or
          the EU–US Data Privacy Framework. You may request access,
          rectification, erasure, restriction, portability and objection. You
          must be 18 to open an account.
        </LegalParagraph>
      </LegalSection>
    </LegalPage>
  );
}
