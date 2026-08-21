import { LegalLayout, LegalSection } from "./LegalLayout";

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        These Terms govern access to and use of Zenguy. By creating an account
        or using the service, you agree to these Terms and our Privacy Policy. If
        you use Zenguy for an organization, you confirm that you may bind that
        organization.
      </p>

      <LegalSection title="1. The service">
        <p>
          Zenguy provides automated browser testing, uptime monitoring, incident
          records, reports, and notifications. Results may contain false
          positives, false negatives, delays, or incomplete information. Zenguy
          is an operational aid and is not a substitute for your own security,
          backup, compliance, or business-continuity controls.
        </p>
      </LegalSection>

      <LegalSection title="2. Accounts and authorized use">
        <p>
          You must provide accurate information, protect your credentials and
          secrets, and promptly report suspected misuse. You may test only sites,
          accounts, and systems you own or are authorized to access. You must not
          use Zenguy to attack, overload, evade controls, scrape unlawfully,
          distribute malware, violate privacy, infringe rights, or break any law.
        </p>
      </LegalSection>

      <LegalSection title="3. Customer content and test data">
        <p>
          You retain ownership of the configurations, instructions, and other
          content you submit. You grant Zenguy the limited rights needed to host,
          process, transmit, and display that content to operate the service. You
          are responsible for the legality, accuracy, permissions, and backup of
          your content and for avoiding unnecessary production personal data in
          tests.
        </p>
      </LegalSection>

      <LegalSection title="4. Notifications and SMS terms">
        <p>
          You must have each recipient's permission before adding an email,
          phone, WhatsApp, or other destination. Zenguy SMS is a recurring
          operational-alert program for requested test failures, downtime,
          recoveries, and channel verification. Message frequency varies with
          monitoring activity and incidents, and may include multiple messages
          per day. Message and data rates may apply. Carriers are not liable for
          delayed or undelivered messages.
        </p>
        <p>
          Reply STOP to opt out of SMS from the sending number or HELP for help.
          You may also remove or disable the channel in Zenguy. Consent to SMS is
          not a condition of purchase. Do not enroll a number if its owner has
          not expressly agreed to these messages.
        </p>
      </LegalSection>

      <LegalSection title="5. Fees and third-party services">
        <p>
          During Zenguy's free launch, no payment method is required and no
          subscription or usage fee is charged. The product limits shown in the
          application still apply. SMS, phone-call, and WhatsApp alerts are an
          optional pay-as-you-go add-on: they are charged per alert, at the
          destination prices shown in the application, from prepaid alert credit
          that you buy in advance. Credit is only spent on alerts you configure,
          never goes negative, and is refunded to the balance when a carrier
          rejects a message. If paid plans are introduced later, their
          price, usage charges, taxes, billing cycle, and cancellation terms will
          be shown before purchase and will require your express agreement.
          Third-party services such as Cloudflare, Twilio, OpenAI, and Paddle may
          have their own terms and availability. Zenguy is not responsible for
          third-party systems outside our reasonable control.
        </p>
      </LegalSection>

      <LegalSection title="6. Intellectual property">
        <p>
          Zenguy and its software, design, documentation, and trademarks are
          protected by intellectual-property laws. Except for the limited right
          to use the service under these Terms, no rights are transferred to you.
          Feedback may be used without restriction or obligation.
        </p>
      </LegalSection>

      <LegalSection title="7. Suspension and termination">
        <p>
          You may stop using Zenguy at any time. We may suspend or terminate
          access for material breach, unlawful or dangerous activity, security
          risk, nonpayment, or when required by law. Where practical, we will
          provide notice and a reasonable opportunity to cure.
        </p>
      </LegalSection>

      <LegalSection title="8. Disclaimers and liability">
        <p>
          To the maximum extent permitted by law, Zenguy is provided “as is” and
          “as available,” without warranties not expressly stated in these Terms.
          Neither party is liable for indirect, incidental, special,
          consequential, or punitive damages, or lost profits, revenue, data, or
          goodwill. Zenguy's aggregate liability relating to the service will not
          exceed the fees you paid for it during the twelve months before the
          event giving rise to liability. These limits do not apply where law
          prohibits them.
        </p>
      </LegalSection>

      <LegalSection title="9. Governing law and changes">
        <p>
          These Terms are governed by the laws of Spain, without regard to
          conflict-of-law rules. Courts in Madrid, Spain have jurisdiction except
          where mandatory consumer or other law requires otherwise. We may update
          these Terms; material changes will be communicated through the service
          or another appropriate channel.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          Questions about these Terms may be sent to{
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
