import { LegalLayout, LegalSection } from "./LegalLayout";
import { CANONICAL_LEGAL } from "./canonical";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        NIESAYO GROUP, S.L. (NIF B23920663), Calle Doctor Pi i Molist, 72, 3º
        2ª, 08016 Barcelona, Spain, is the controller of personal data for
        Zenguy. Contact{" "}
        <a className="text-accent-700 hover:underline" href="mailto:privacy@zenguy.com">
          privacy@zenguy.com
        </a>
        . You may also complain to the Spanish Data Protection Agency (AEPD).
      </p>
      <p>
        The full policy — purposes and legal bases, processors, transfers,
        retention, rights and SMS rules under the GDPR and LOPDGDD — is
        published at{" "}
        <a className="text-accent-700 hover:underline" href={CANONICAL_LEGAL.privacy}>
          zenguy.com/privacy
        </a>
        .
      </p>

      <LegalSection title="What we process">
        <p>
          Account and contact data, workspace membership, test and monitor
          configuration, encrypted secrets, run evidence (screenshots, logs,
          reports) for 30 days, billing records via Stripe, security logs, and
          notification destinations you add (email, phone, webhooks).
        </p>
      </LegalSection>

      <LegalSection title="Why">
        <p>
          We process account and service data to perform the contract (GDPR
          art. 6.1.b), billing and tax data because the law requires it (art.
          6.1.c), and security logs on the basis of legitimate interests (art.
          6.1.f). Product emails use consent (art. 6.1.a and art. 21 LSSI-CE)
          and are optional. We do not sell personal data or build advertising
          profiles.
        </p>
      </LegalSection>

      <LegalSection title="Your content in tests">
        <p>
          You are the controller of personal data that appears on the sites you
          ask us to watch. Zenguy is the processor. Avoid unnecessary
          production personal data in tests. Processor terms are in the{" "}
          <a className="text-accent-700 hover:underline" href={CANONICAL_LEGAL.terms}>
            Terms of Service
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="SMS and phone">
        <p>
          We do not sell mobile numbers or SMS opt-in data, and we do not share
          them with third parties for their marketing. Operational alerts go
          only to numbers you enrol, after an explicit checkbox. Reply STOP to
          opt out or HELP for help. Consent to SMS is not a condition of
          purchase.
        </p>
      </LegalSection>

      <LegalSection title="Providers and transfers">
        <p>
          Cloudflare, Stripe, Twilio, OpenAI and Expo process data to operate
          Zenguy. Some processing takes place outside the EEA using Standard
          Contractual Clauses and, where applicable, the EU–US Data Privacy
          Framework.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          You may request access, rectification, erasure, restriction,
          portability and objection, and you may withdraw consent. Email{" "}
          <a className="text-accent-700 hover:underline" href="mailto:privacy@zenguy.com">
            privacy@zenguy.com
          </a>
          . Zenguy is a business service; you must be 18 to open an account.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
