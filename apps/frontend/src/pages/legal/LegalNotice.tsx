import { LegalLayout, LegalSection } from "./LegalLayout";
import { CANONICAL_LEGAL } from "./canonical";

export default function LegalNotice() {
  return (
    <LegalLayout title="Legal notice">
      <p>
        This is the identifying information required by article 10 of Spain’s
        LSSI-CE (Law 34/2002). The full notice is at{" "}
        <a className="text-accent-700 hover:underline" href={CANONICAL_LEGAL.legalNotice}>
          zenguy.com/legal-notice
        </a>
        .
      </p>
      <LegalSection title="Service provider">
        <p>
          NIESAYO GROUP, S.L. (trade name Zenguy). NIF B23920663. Registered
          office: Calle Doctor Pi i Molist, 72, 3º 2ª, 08016 Barcelona, Spain.
          Registro Mercantil de Barcelona, hoja B-642991, inscripción 1ª.
          Email{" "}
          <a className="text-accent-700 hover:underline" href="mailto:privacy@zenguy.com">
            privacy@zenguy.com
          </a>
          .
        </p>
      </LegalSection>
      <LegalSection title="Websites">
        <p>
          <a className="text-accent-700 hover:underline" href="https://zenguy.com">
            zenguy.com
          </a>{" "}
          and{" "}
          <a className="text-accent-700 hover:underline" href="https://app.zenguy.com">
            app.zenguy.com
          </a>
          . Use of the product is also governed by the{" "}
          <a className="text-accent-700 hover:underline" href={CANONICAL_LEGAL.terms}>
            Terms of Service
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
