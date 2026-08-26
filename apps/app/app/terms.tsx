import {
  LegalContactEmail,
  LegalPage,
  LegalParagraph,
  LegalSection,
} from "@/components/legal/LegalPage";

export default function Terms() {
  return (
    <LegalPage related={{ href: "/privacy", label: "Privacy Policy" }} title="Terms of Service">
      <LegalParagraph>
        These Terms govern access to and use of Zenguy. By creating an account or using the
        service, you agree to these Terms and our Privacy Policy. If you use Zenguy for an
        organization, you confirm that you may bind that organization.
      </LegalParagraph>

      <LegalSection title="1. The service">
        <LegalParagraph>
          Zenguy provides automated browser testing, uptime monitoring, incident records,
          reports, and notifications. Results may contain false positives, false negatives,
          delays, or incomplete information. Zenguy is an operational aid and is not a
          substitute for your own security, backup, compliance, or business-continuity controls.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="2. Accounts and authorized use">
        <LegalParagraph>
          You must provide accurate information, protect your credentials and secrets, and
          promptly report suspected misuse. You may test only sites, accounts, and systems you
          own or are authorized to access. You must not use Zenguy to attack, overload, evade
          controls, scrape unlawfully, distribute malware, violate privacy, infringe rights, or
          break any law.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="3. Customer content and test data">
        <LegalParagraph>
          You retain ownership of the configurations, instructions, and other content you
          submit. You grant Zenguy the limited rights needed to host, process, transmit, and
          display that content to operate the service. You are responsible for the legality,
          accuracy, permissions, and backup of your content and for avoiding unnecessary
          production personal data in tests.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="4. Notifications and SMS terms">
        <LegalParagraph>
          You must have each recipient&apos;s permission before adding an email, phone, WhatsApp, or
          other destination. Zenguy SMS is a recurring operational-alert program for requested
          test failures, downtime, recoveries, and channel verification. Message frequency
          varies with monitoring activity and incidents, and may include multiple messages per
          day. Message and data rates may apply. Carriers are not liable for delayed or
          undelivered messages.
        </LegalParagraph>
        <LegalParagraph>
          Reply STOP to opt out of SMS from the sending number or HELP for help. You may also
          remove or disable the channel in Zenguy. Consent to SMS is not a condition of
          purchase. Do not enroll a number if its owner has not expressly agreed to these
          messages.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="5. Fees and third-party services">
        <LegalParagraph>
          Zenguy may offer paid subscriptions and prepaid alert credit. Prices, included usage,
          taxes, billing cycle, renewal, and cancellation terms are shown before purchase and
          require your express agreement. Subscriptions renew until canceled; cancellation takes
          effect as shown in the billing portal. Third-party services such as Cloudflare, Twilio,
          OpenAI, and Stripe may have their own terms and availability. Zenguy is not responsible
          for third-party systems outside our reasonable control.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="6. Intellectual property">
        <LegalParagraph>
          Zenguy and its software, design, documentation, and trademarks are protected by
          intellectual-property laws. Except for the limited right to use the service under
          these Terms, no rights are transferred to you. Feedback may be used without
          restriction or obligation.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="7. Suspension and termination">
        <LegalParagraph>
          You may stop using Zenguy at any time. We may suspend or terminate access for material
          breach, unlawful or dangerous activity, security risk, nonpayment, or when required by
          law. Where practical, we will provide notice and a reasonable opportunity to cure.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="8. Disclaimers and liability">
        <LegalParagraph>
          To the maximum extent permitted by law, Zenguy is provided “as is” and “as
          available,” without warranties not expressly stated in these Terms. Neither party is
          liable for indirect, incidental, special, consequential, or punitive damages, or lost
          profits, revenue, data, or goodwill. Zenguy&apos;s aggregate liability relating to the
          service will not exceed the fees you paid for it during the twelve months before the
          event giving rise to liability. These limits do not apply where law prohibits them.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="9. Governing law and changes">
        <LegalParagraph>
          These Terms are governed by the laws of Spain, without regard to conflict-of-law
          rules. Courts in Madrid, Spain have jurisdiction except where mandatory consumer or
          other law requires otherwise. We may update these Terms; material changes will be
          communicated through the service or another appropriate channel.
        </LegalParagraph>
      </LegalSection>

      <LegalSection title="10. Contact">
        <LegalParagraph>
          Questions about these Terms may be sent to <LegalContactEmail />.
        </LegalParagraph>
      </LegalSection>
    </LegalPage>
  );
}
