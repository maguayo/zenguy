import { LegalLayout, LegalSection } from "./LegalLayout";
import { CANONICAL_LEGAL } from "./canonical";

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        These Terms govern Zenguy, a service of NIESAYO GROUP, S.L. (NIF
        B23920663), Barcelona. Creating an account means you agree to them and
        have read the{" "}
        <a className="text-accent-700 hover:underline" href={CANONICAL_LEGAL.privacy}>
          Privacy Policy
        </a>
        . The full text is at{" "}
        <a className="text-accent-700 hover:underline" href={CANONICAL_LEGAL.terms}>
          zenguy.com/terms
        </a>
        .
      </p>

      <LegalSection title="1. The service">
        <p>
          Zenguy runs natural-language browser tests and HTTP uptime checks,
          stores evidence, and sends alerts. Results can be wrong or late. It
          is an operational aid, not a substitute for your own security, QA or
          backups.
        </p>
      </LegalSection>

      <LegalSection title="2. Accounts and acceptable use">
        <p>
          You must be 18 or older, keep credentials safe, and test only systems
          you own or are authorised to access. Do not attack, overload, scrape
          unlawfully, or use Zenguy to break the law.
        </p>
      </LegalSection>

      <LegalSection title="3. Your content">
        <p>
          You keep ownership of what you submit. You grant us the rights needed
          to operate the service. When tests capture third-party personal data,
          you are the controller and we are the processor (GDPR art. 28).
        </p>
      </LegalSection>

      <LegalSection title="4. Notifications and SMS">
        <p>
          Get each recipient’s permission before adding a channel. SMS is a
          recurring operational-alert programme; frequency follows your
          monitors. Reply STOP to opt out or HELP for help. Consent to SMS is
          not a condition of purchase.
        </p>
      </LegalSection>

      <LegalSection title="5. Fees">
        <p>
          Prices, taxes, included runs, overage and renewal are shown in Stripe
          Checkout before you pay. Subscriptions renew until cancelled.
          Creating an account asks us to start the digital service immediately;
          consumers then lose the 14-day withdrawal right once performance has
          begun, as EU consumer law allows.
        </p>
      </LegalSection>

      <LegalSection title="6. Liability and law">
        <p>
          These Terms do not limit liability that Spanish or EU law forbids
          limiting (including intent, gross negligence and mandatory consumer
          rights). Otherwise, aggregate liability is limited to the fees you
          paid in the previous twelve months, or 39 € if you paid nothing.
          Spanish law applies. Courts of Barcelona have jurisdiction, except
          that consumers may use the courts of their domicile.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
