import {
  LegalContactEmail,
  LegalExternalLink,
  LegalPage,
  LegalParagraph,
  LegalSection,
} from "@/components/legal/LegalPage";

export default function Terms() {
  return (
    <LegalPage related={{ href: "/privacy", label: "Privacy Policy" }} title="Terms of Service">
      <LegalParagraph>
        These Terms govern Zenguy, a service of NIESAYO GROUP, S.L. (NIF
        B23920663), Barcelona. Using your existing Zenguy account means you
        agree to them. Zenguy for iOS is a companion app: it only signs in
        existing users and does not offer account or workspace creation,
        subscription activation, purchases, or payment management. The full
        text is at{" "}
        <LegalExternalLink
          label="https://zenguy.com/terms/"
          url="https://zenguy.com/terms/"
        />
        .
      </LegalParagraph>

      <LegalSection title="1. The service">
        <LegalParagraph>
          Zenguy runs natural-language browser tests and HTTP uptime checks,
          stores evidence, and sends alerts. Results can be wrong or late. It is
          an operational aid, not a substitute for your own security, QA or
          backups.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="2. Accounts and use">
        <LegalParagraph>
          You must be 18 or older, keep credentials safe, and test only systems
          you own or are authorised to access. Do not attack, overload, scrape
          unlawfully, or use Zenguy to break the law.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="3. Your content">
        <LegalParagraph>
          You keep ownership of what you submit. When tests capture third-party
          personal data, you are the controller and we are the processor (GDPR
          art. 28).
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="4. Notifications and SMS">
        <LegalParagraph>
          Get each recipient’s permission before adding a channel. SMS is a
          recurring operational-alert programme. Reply STOP to opt out or HELP
          for help. Consent to SMS is not a condition of purchase.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="5. Web-service fees, liability and law">
        <LegalParagraph>
          Any subscription for the separate web service is governed by the
          order accepted outside this app. Zenguy for iOS does not display
          prices or purchase links and cannot activate, cancel, or manage a
          subscription or payment. These Terms do not limit liability that
          Spanish or EU law forbids limiting. Spanish law applies. Courts of
          Barcelona have jurisdiction, except that consumers may use the courts
          of their domicile. Questions: <LegalContactEmail />.
        </LegalParagraph>
      </LegalSection>
    </LegalPage>
  );
}
