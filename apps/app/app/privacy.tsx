import {
  LegalContactEmail,
  LegalExternalLink,
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
        Protection Agency (AEPD). Read the canonical policy at{" "}
        <LegalExternalLink
          label="https://zenguy.com/privacy/"
          url="https://zenguy.com/privacy/"
        />
        .
      </LegalParagraph>

      <LegalSection title="What we process">
        <LegalParagraph>
          Account and contact data, workspace membership, test and monitor
          configuration, encrypted secrets, target URLs and instructions, run
          evidence, notification destinations, subscription status, security
          records, and the app/device information needed for updates and push.
          The signed-in app also records app opens and normalized screen or
          resource visits, linked to the account, for operation, support,
          security, reliability, and aggregate first-party usage reporting.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Why">
        <LegalParagraph>
          Account and service data: contract (GDPR art. 6.1.b). Billing and tax:
          legal obligation (art. 6.1.c). Security: legitimate interests (art.
          6.1.f). Product emails: consent, optional, and not required to use the
          iOS app. We do not sell personal data.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Your tests">
        <LegalParagraph>
          You are the controller of personal data that appears on the sites you
          ask us to watch. Zenguy is the processor. Avoid unnecessary production
          personal data in tests.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="Optional OpenAI processing">
        <LegalParagraph>
          Runs use Zenguy&apos;s private local runner by default. An Owner or
          Admin may separately opt a workspace into OpenAI fallback processing
          from AI data sharing. The choice starts off, is never preselected,
          records the policy version, date and actor, and can be revoked there
          at any time. If enabled, test instructions, target URLs, relevant page
          content, screenshots and technical results may be sent to OpenAI only
          to execute and assess browser-test steps. Account, billing, member and
          notification data are excluded. Secret values are never disclosed to
          OpenAI; remote runs receive placeholders only. OpenAI API inputs and
          outputs are not used to train its models by default and its standard
          abuse-monitoring logs may be retained for up to 30 days.
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

      <LegalSection title="Retention and deletion">
        <LegalParagraph>
          Run evidence is normally retained for 30 days. High-volume screen and
          view activity is retained for up to 90 days and other account activity
          for up to 365 days. In Account, you can delete the account directly:
          sessions and push tokens are revoked, memberships are removed, owned
          workspaces are made inaccessible and purged, and the user record is
          anonymized. Financial or tax records may remain for up to six years
          and necessary security records for up to twelve months, without using
          them to keep the deleted account active.
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
        <LegalParagraph>
          See and manage the available controls at{" "}
          <LegalExternalLink
            label="https://zenguy.com/privacy-choices/"
            url="https://zenguy.com/privacy-choices/"
          />
          .
        </LegalParagraph>
      </LegalSection>
    </LegalPage>
  );
}
