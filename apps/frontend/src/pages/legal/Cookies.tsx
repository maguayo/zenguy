import { useCookieConsent } from "../../components/CookieConsent";
import { Button } from "../../components/ui/Button";
import { LegalLayout, LegalSection } from "./LegalLayout";
import { CANONICAL_LEGAL } from "./canonical";

const GOOGLE_COOKIE_INFORMATION =
  "https://support.google.com/analytics/answer/11397207";
const GOOGLE_CONSENT_MODE =
  "https://developers.google.com/tag-platform/security/concepts/consent-mode";
const AEPD_COOKIE_GUIDE = "https://www.aepd.es/guias/guia-cookies.pdf";

export default function Cookies() {
  const { available, openPreferences } = useCookieConsent();

  return (
    <LegalLayout lastUpdated="30 August 2026" title="Cookie Policy">
      <p>
        This policy explains storage used on app.zenguy.com under article 22.2
        LSSI-CE and the{" "}
        <a className="text-accent-700 hover:underline" href={AEPD_COOKIE_GUIDE}>
          AEPD Cookie Guide
        </a>
        . The policy for the marketing site is published at{" "}
        <a className="text-accent-700 hover:underline" href={CANONICAL_LEGAL.cookies}>
          zenguy.com/cookies
        </a>
        . Browser local storage is isolated by origin, so your choice on one
        Zenguy subdomain is not automatically copied to another.
      </p>

      <LegalSection title="Necessary storage">
        <p>
          The API uses the strictly necessary first-party cookie
          <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 text-xs">
            zenguy_rt
          </code>
          to renew your authenticated session. It is HttpOnly, SameSite=Lax,
          host-only, limited to <code>/api/auth</code>, Secure in production and
          expires after at most 30 days. The short-lived access token stays only
          in application memory. Google sign-in also uses the temporary
          HttpOnly cookie <code>zenguy_google_oauth</code>, limited to its OAuth
          path and at most 10 minutes. Cloudflare may use security storage to
          protect the service. We also save your cookie choice in local storage under
          <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 text-xs">
            zenguy:cookie-consent:v1
          </code>
          so we can respect it. These purposes remain available when analytics
          is rejected.
        </p>
        <p>
          If local storage cannot save or verify a choice, session storage may
          keep the same record for the current tab under
          <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 text-xs">
            zenguy:cookie-consent-session-override:v1
          </code>
          . This fail-safe prevents a withdrawal reverting to an older choice,
          ends with the browser session and is not sent to Google.
        </p>
      </LegalSection>

      <LegalSection title="Web fonts">
        <p>
          The application requests Inter, IBM Plex Mono and Newsreader from
          Google Fonts to render its interface. This request is separate from
          Google Analytics and can occur before an analytics choice; Google may
          receive technical delivery data such as your IP address. The
          canonical Privacy Policy explains the applicable purpose and legal
          basis.
        </p>
      </LegalSection>

      <LegalSection title="Optional Google Analytics">
        <p>
          If you accept analytics, we load Google Analytics 4 to understand
          normalized page categories and a limited set of product milestones,
          such as successful registration, starting Stripe checkout and a
          purchase only after the billing API confirms an active subscription
          with a recent paid invoice. Advertising storage, advertising user
          data, ad personalization and Google Signals remain disabled.
        </p>
        <p>
          Google documents the first-party cookies <code>_ga</code> and
          <code className="ml-1">_ga_&lt;container-id&gt;</code>, normally with
          a maximum lifetime of two years, in its{" "}
          <a
            className="text-accent-700 hover:underline"
            href={GOOGLE_COOKIE_INFORMATION}
          >
            GA4 cookie information
          </a>
          . We renew the consent decision no later than 24 months after it was
          recorded.
        </p>
        <p>
          When an accepted live checkout begins, session storage keeps a
          short-lived correlation marker. It is ignored after 24 hours and
          removed when next checked or when the browser session ends. It ensures that
          a purchase is counted only for a checkout started in the same browser
          tab and a matching initial invoice. Its local workspace key is not
          sent to Google and is removed after successful correlation.
        </p>
      </LegalSection>

      <LegalSection title="What analytics receives">
        <p>
          Events use route templates such as
          <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 text-xs">
            /w/:wsId/tests/:testId
          </code>
          rather than real identifiers. Query strings, URL fragments, email
          verification/reset tokens, names, email addresses, form contents,
          test URLs, instructions, secrets and workspace/resource IDs are not
          sent. A confirmed purchase includes its provider transaction reference,
          currency and plan value so Google can deduplicate the transaction.
          Google Analytics also processes standard browser/device information
          and derives approximate geography.
        </p>
        <p>
          After a signed-in user consents, the browser derives a
          purpose-specific pseudonymous Analytics User-ID from the opaque
          internal account identifier. The raw identifier, name and email are
          not sent. This supports a more consistent consented-user count across
          browsers and devices. Finite categories can also include route
          section, authentication state, account-age and workspace-count band,
          and the current workspace role and subscription status, never its id
          or name.
        </p>
      </LegalSection>

      <LegalSection title="Consent and withdrawal">
        <p>
          We use Google&apos;s basic Consent Mode v2: before acceptance the
          Google tag is not loaded and no Google Analytics request or consent
          signal is sent. Reject and accept are presented at the same level and the
          service continues when you reject. The implementation follows
          Google&apos;s{" "}
          <a className="text-accent-700 hover:underline" href={GOOGLE_CONSENT_MODE}>
            basic Consent Mode description
          </a>
          .
        </p>
        <p>
          You can withdraw consent at any time. We then deny analytics storage,
          stop sending analytics events and remove Google Analytics cookies
          accessible to this application. Withdrawal does not affect processing
          that occurred while consent was valid.
        </p>
        {available ? (
          <Button variant="secondary" onClick={openPreferences}>
            Open cookie preferences
          </Button>
        ) : (
          <p>
            Analytics and its preference panel are enabled only on the production
            host app.zenguy.com; they are disabled on localhost, preview and
            staging hosts.
          </p>
        )}
      </LegalSection>

      <LegalSection title="Provider and transfers">
        <p>
          Google Ireland Limited provides Google Analytics. Google may process
          data outside the EEA under the transfer mechanisms described in its{" "}
          <a className="text-accent-700 hover:underline" href="https://policies.google.com/privacy">
            Privacy Policy
          </a>
          . See our{" "}
          <a className="text-accent-700 hover:underline" href={CANONICAL_LEGAL.privacy}>
            Privacy Policy
          </a>{" "}
          for controller details, purposes, retention and your data-protection
          rights.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
