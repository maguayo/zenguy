import { LegalLayout, LegalSection } from "./LegalLayout";
import { CANONICAL_LEGAL } from "./canonical";

export default function Cookies() {
  return (
    <LegalLayout title="Cookie Policy">
      <p>
        Under article 22.2 LSSI-CE and AEPD cookie guidance. The full policy
        is at{" "}
        <a className="text-accent-700 hover:underline" href={CANONICAL_LEGAL.cookies}>
          zenguy.com/cookies
        </a>
        .
      </p>
      <LegalSection title="What we use">
        <p>
          We do not use advertising or analytics cookies. The application sets
          a strictly necessary session cookie so you stay signed in. Cloudflare
          may set a security cookie. Stripe sets cookies on its own domains
          when you pay. The marketing site loads fonts from Google Fonts.
        </p>
      </LegalSection>
      <LegalSection title="Consent">
        <p>
          Strictly necessary cookies do not need prior consent. If we later add
          non-essential cookies, we will ask first, with reject as easy as
          accept. Pre-ticked boxes are not consent.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
