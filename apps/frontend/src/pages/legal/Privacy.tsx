import { LegalLayout, LegalSection } from "./LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        This Privacy Policy explains how Zenguy collects, uses, and protects
        personal data when you use our website, application, browser testing,
        uptime monitoring, incident, and notification services.
      </p>

      <LegalSection title="1. Data we collect">
        <p>
          We collect account and contact information, workspace membership,
          product configuration, usage and billing records, support
          communications, and security and technical logs. When you configure a
          notification channel, we also process its destination, such as an
          email address, phone number, or provider webhook.
        </p>
        <p>
          Browser tests and uptime monitors may create run logs, screenshots,
          network diagnostics, and incident reports. You are responsible for
          ensuring that the targets and test data you provide may lawfully be
          processed by Zenguy.
        </p>
      </LegalSection>

      <LegalSection title="2. How we use data">
        <p>
          We use personal data to provide and secure Zenguy, authenticate users,
          execute tests and monitors, send requested operational alerts, provide
          support, administer subscriptions, prevent abuse, comply with law, and
          improve reliability. Depending on the context, our legal bases include
          performance of a contract, legitimate interests, legal obligations,
          and consent.
        </p>
      </LegalSection>

      <LegalSection title="3. SMS privacy and consent">
        <p>
          Zenguy does not sell mobile numbers or SMS opt-in data. We do not share
          mobile numbers or SMS consent with third parties or affiliates for
          their marketing or promotional purposes. We disclose them only to
          service providers that deliver Zenguy messages on our behalf, such as
          Twilio, or when required by law. Those providers may use the data only
          to perform services for Zenguy under their contractual obligations.
        </p>
        <p>
          SMS messages are recurring operational alerts requested by the user,
          such as test failures, downtime, recoveries, and channel-verification
          messages. Frequency varies with the configured monitoring activity and
          incidents, and recipients may receive multiple messages per day.
          Message and data rates may apply. Reply STOP to opt out or HELP for
          help. Consent to SMS is not a condition of purchasing Zenguy.
        </p>
      </LegalSection>

      <LegalSection title="4. Service providers and international transfers">
        <p>
          We use service providers for infrastructure, communications, AI,
          payment processing when enabled, security, and support. These may
          include Cloudflare, Twilio, OpenAI, and Paddle. They process data under
          contractual safeguards and only as needed to provide their services.
          Data may be processed outside your country using applicable transfer
          safeguards.
        </p>
      </LegalSection>

      <LegalSection title="5. Retention and security">
        <p>
          We retain data only for as long as needed for the purposes described
          above, contractual and legal obligations, dispute resolution, and
          security. Retention periods depend on the data category and account
          state. We use access controls, encryption, secret redaction, and other
          technical and organizational measures, but no service can guarantee
          absolute security.
        </p>
      </LegalSection>

      <LegalSection title="6. Your rights">
        <p>
          Depending on your location, you may request access, correction,
          deletion, restriction, portability, or objection, and may withdraw
          consent at any time without affecting earlier lawful processing. You
          may also complain to your local data protection authority. We may need
          to verify your identity before acting on a request.
        </p>
      </LegalSection>

      <LegalSection title="7. Children and changes">
        <p>
          Zenguy is a business service and is not directed to children. We may
          update this policy as the service or law changes. Material changes will
          be communicated through the service or another appropriate channel.
        </p>
      </LegalSection>

      <LegalSection title="8. Contact">
        <p>
          For privacy questions or rights requests, email{
          " "}
          <a className="text-accent-700 hover:underline" href="mailto:privacy@zenguy.com">
            privacy@zenguy.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
