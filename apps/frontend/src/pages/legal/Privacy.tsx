import { LegalLayout, LegalSection } from "./LegalLayout";
import { CANONICAL_LEGAL } from "./canonical";

export default function Privacy() {
  return (
    <LegalLayout lastUpdated="30 August 2026" title="Privacy Policy">
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
          notification destinations you add (email, phone, webhooks). Our
          first-party service also records signed-in account activity: the
          internal account id, web/app source, event time, normalized page or
          screen category and, where relevant, workspace/resource ids. Page,
          screen and view events are retained for up to 90 days and other
          product events for up to 365 days. If you consent to optional
          analytics, we also process normalized page
          categories, browser/device information, approximate geography and a
          purpose-specific pseudonymous account identifier, finite account and
          workspace categories, and a limited set of product and billing
          milestones.
        </p>
      </LegalSection>

      <LegalSection title="Why">
        <p>
          We process account and service data to perform the contract (GDPR
          art. 6.1.b), billing and tax data because the law requires it (art.
          6.1.c), and security logs on the basis of legitimate interests (art.
          6.1.f). First-party authenticated activity supports account
          operation and support under the contract, and service reliability,
          abuse prevention and aggregate product improvement under legitimate
          interests (art. 6.1.f); it is separate from Google Analytics and
          advertising. Product emails use consent (art. 6.1.a and art. 21 LSSI-CE)
          and are optional. Google Analytics is also based exclusively on your
          consent (art. 6.1.a and art. 22.2 LSSI-CE); rejecting it does not
          affect access to Zenguy. We do not sell personal data or build
          advertising profiles. Google Fonts delivery is separate from
          Analytics and is based on our legitimate interest in presenting a
          consistent, readable web interface (art. 6.1.f).
        </p>
      </LegalSection>

      <LegalSection title="Optional product analytics">
        <p>
          Google Analytics 4 is completely blocked until you accept it. Events
          contain allow-listed route templates and low-cardinality milestones.
          They exclude query strings, URL fragments, form contents, names,
          emails, test URLs, instructions, secrets, tokens and workspace or
          resource IDs. Confirmed purchases include a pseudonymous billing
          transaction reference, currency and plan value to prevent duplicate
          transactions. After a signed-in user consents, the browser derives a
          purpose-specific pseudonymous Analytics User-ID from the opaque
          internal account identifier; the raw identifier, name and email are
          not sent. It supports a more consistent count across browsers and
          devices. Low-cardinality categories may include account-age and
          workspace-count bands plus current workspace role and subscription
          status, never a workspace id or name.
        </p>
        <p>
          Advertising storage, advertising user data, ad personalization and
          Google Signals are disabled. Google states that for EU traffic it
          derives coarse geography before discarding the IP address rather than
          logging or storing the address. See Google&apos;s{" "}
          <a
            className="text-accent-700 hover:underline"
            href="https://support.google.com/analytics/answer/12017362"
          >
            EU-focused data and privacy information
          </a>
          . User-level and event-level analytics data is retained for no more
          than 14 months in the GA4 property.
        </p>
        <p>
          You can reject or later withdraw analytics using the Cookie
          preferences control. Withdrawal stops future analytics events and
          removes Google Analytics cookies accessible to the application; it
          does not affect processing already carried out with valid consent.
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
          Zenguy. If analytics is accepted, Google Ireland Limited also
          processes the optional analytics data described above. Google also
          receives the technical request data needed to deliver the
          application&apos;s web fonts independently of Analytics consent. Some
          processing takes place outside the EEA using Standard Contractual
          Clauses and, where applicable, the EU–US Data Privacy Framework. See
          Google&apos;s{" "}
          <a
            className="text-accent-700 hover:underline"
            href="https://policies.google.com/privacy"
          >
            Privacy Policy
          </a>
          .
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
