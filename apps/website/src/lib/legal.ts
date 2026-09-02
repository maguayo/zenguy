export const LEGAL_VERSION = "2026-09-02";
export const LEGAL_EFFECTIVE = "2 September 2026";

/** Public identification of the information-society service provider (LSSI-CE art. 10). */
export const legalCompany = {
  legalName: "NIESAYO GROUP, S.L.",
  tradeName: "Zenguy",
  nif: "B23920663",
  addressLine: "Calle Doctor Pi i Molist, 72, 3º 2ª",
  postalCode: "08016",
  city: "Barcelona",
  country: "Spain",
  registry:
    "Registro Mercantil de Barcelona, hoja B-642991, inscripción 1ª",
  email: "privacy@zenguy.com",
  site: "https://zenguy.com",
  app: "https://app.zenguy.com",
} as const;

export const legalAddress = `${legalCompany.addressLine}, ${legalCompany.postalCode} ${legalCompany.city}, ${legalCompany.country}`;

export const legalMailto = `mailto:${legalCompany.email}`;
