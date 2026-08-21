/**
 * Pay-as-you-go pricing for phone alerts (SMS, voice calls, WhatsApp).
 *
 * Every price is derived from Twilio's public pay-as-you-go rates for our
 * US long code (+1 850 493 6489), captured from twilio.com/en-us/{sms,voice}/
 * pricing/<country> on PRICING_CAPTURED_ON. SMS uses the "International /
 * Mobile numbers" outbound rate; calls use the mobile rate billed to a
 * non-EEA (US/CA) origination, which is the relevant one for our number.
 *
 * Final price per alert, in euro cents:
 *   max(minimum, ceil(twilioUsd × ALERT_PRICE_MARKUP × 100))
 * USD is deliberately treated as 1:1 with EUR; the markup absorbs FX drift,
 * Twilio's fixed monthly fees (number, A2P campaign), carrier surcharges and
 * failed-attempt fees. One alert always costs exactly one unit: SMS bodies are
 * trimmed to a single segment and calls are capped below one billed minute.
 */

export const PRICING_CAPTURED_ON = "2026-08-21";
export const ALERT_PRICE_MARKUP = 2;
export const ALERT_SMS_MIN_CENTS = 5;
export const ALERT_CALL_MIN_CENTS = 20;
export const ALERT_ROW_SMS_CENTS = 40;
export const ALERT_ROW_CALL_CENTS = 80;
export const ALERT_CURRENCY = "EUR" as const;

export type AlertRegion = "US_CA" | "EUROPE" | "ROW";
export type PaidAlertKind = "SMS" | "CALL";

export interface CountryRate {
  iso: string;
  name: string;
  region: AlertRegion;
  dialingCode: string;
  /** Twilio outbound SMS, USD per message (segment). */
  twilioSmsUsd: number;
  /** Twilio outbound voice to a mobile from a US origination, USD per minute. */
  twilioCallUsd: number;
}

export interface CountryPrice {
  iso: string;
  name: string;
  region: AlertRegion;
  smsCents: number;
  callCents: number;
}

export interface Destination {
  /** ISO 3166-1 alpha-2, or null when the prefix is unknown. */
  iso: string | null;
  name: string;
  region: AlertRegion;
}

export interface AlertQuote {
  destination: Destination;
  smsCents: number;
  callCents: number;
}

// Twilio rates captured on PRICING_CAPTURED_ON. The US and Canadian SMS
// figures include the highest published per-message carrier fee.
export const PRICED_COUNTRIES: readonly CountryRate[] = [
  { iso: "US", name: "United States", region: "US_CA", dialingCode: "1", twilioSmsUsd: 0.0133, twilioCallUsd: 0.014 },
  { iso: "CA", name: "Canada", region: "US_CA", dialingCode: "1", twilioSmsUsd: 0.017, twilioCallUsd: 0.014 },
  { iso: "AT", name: "Austria", region: "EUROPE", dialingCode: "43", twilioSmsUsd: 0.0979, twilioCallUsd: 0.0495 },
  { iso: "BE", name: "Belgium", region: "EUROPE", dialingCode: "32", twilioSmsUsd: 0.1113, twilioCallUsd: 0.0387 },
  { iso: "BG", name: "Bulgaria", region: "EUROPE", dialingCode: "359", twilioSmsUsd: 0.1466, twilioCallUsd: 0.2109 },
  { iso: "HR", name: "Croatia", region: "EUROPE", dialingCode: "385", twilioSmsUsd: 0.1379, twilioCallUsd: 0.095 },
  { iso: "CY", name: "Cyprus", region: "EUROPE", dialingCode: "357", twilioSmsUsd: 0.0864, twilioCallUsd: 0.1675 },
  { iso: "CZ", name: "Czechia", region: "EUROPE", dialingCode: "420", twilioSmsUsd: 0.0706, twilioCallUsd: 0.1499 },
  { iso: "DK", name: "Denmark", region: "EUROPE", dialingCode: "45", twilioSmsUsd: 0.0592, twilioCallUsd: 0.0564 },
  { iso: "EE", name: "Estonia", region: "EUROPE", dialingCode: "372", twilioSmsUsd: 0.0958, twilioCallUsd: 0.0633 },
  { iso: "FI", name: "Finland", region: "EUROPE", dialingCode: "358", twilioSmsUsd: 0.0861, twilioCallUsd: 0.044 },
  { iso: "FR", name: "France", region: "EUROPE", dialingCode: "33", twilioSmsUsd: 0.0798, twilioCallUsd: 0.0404 },
  { iso: "DE", name: "Germany", region: "EUROPE", dialingCode: "49", twilioSmsUsd: 0.112, twilioCallUsd: 0.042 },
  { iso: "GR", name: "Greece", region: "EUROPE", dialingCode: "30", twilioSmsUsd: 0.0657, twilioCallUsd: 0.4964 },
  { iso: "HU", name: "Hungary", region: "EUROPE", dialingCode: "36", twilioSmsUsd: 0.091, twilioCallUsd: 0.1155 },
  { iso: "IS", name: "Iceland", region: "EUROPE", dialingCode: "354", twilioSmsUsd: 0.0719, twilioCallUsd: 0.05 },
  { iso: "IE", name: "Ireland", region: "EUROPE", dialingCode: "353", twilioSmsUsd: 0.0779, twilioCallUsd: 0.0945 },
  { iso: "IT", name: "Italy", region: "EUROPE", dialingCode: "39", twilioSmsUsd: 0.0927, twilioCallUsd: 0.0445 },
  { iso: "LV", name: "Latvia", region: "EUROPE", dialingCode: "371", twilioSmsUsd: 0.0801, twilioCallUsd: 0.5318 },
  { iso: "LT", name: "Lithuania", region: "EUROPE", dialingCode: "370", twilioSmsUsd: 0.0578, twilioCallUsd: 0.5921 },
  { iso: "LU", name: "Luxembourg", region: "EUROPE", dialingCode: "352", twilioSmsUsd: 0.0818, twilioCallUsd: 0.3282 },
  { iso: "MT", name: "Malta", region: "EUROPE", dialingCode: "356", twilioSmsUsd: 0.0689, twilioCallUsd: 0.5679 },
  { iso: "NL", name: "Netherlands", region: "EUROPE", dialingCode: "31", twilioSmsUsd: 0.1143, twilioCallUsd: 0.2763 },
  { iso: "NO", name: "Norway", region: "EUROPE", dialingCode: "47", twilioSmsUsd: 0.0697, twilioCallUsd: 0.077 },
  { iso: "PL", name: "Poland", region: "EUROPE", dialingCode: "48", twilioSmsUsd: 0.0457, twilioCallUsd: 0.2202 },
  { iso: "PT", name: "Portugal", region: "EUROPE", dialingCode: "351", twilioSmsUsd: 0.0501, twilioCallUsd: 0.0495 },
  { iso: "RO", name: "Romania", region: "EUROPE", dialingCode: "40", twilioSmsUsd: 0.0781, twilioCallUsd: 0.032 },
  { iso: "SK", name: "Slovakia", region: "EUROPE", dialingCode: "421", twilioSmsUsd: 0.0883, twilioCallUsd: 0.1158 },
  { iso: "SI", name: "Slovenia", region: "EUROPE", dialingCode: "386", twilioSmsUsd: 0.2051, twilioCallUsd: 0.6633 },
  { iso: "ES", name: "Spain", region: "EUROPE", dialingCode: "34", twilioSmsUsd: 0.0875, twilioCallUsd: 0.0486 },
  { iso: "SE", name: "Sweden", region: "EUROPE", dialingCode: "46", twilioSmsUsd: 0.0646, twilioCallUsd: 0.0714 },
  { iso: "CH", name: "Switzerland", region: "EUROPE", dialingCode: "41", twilioSmsUsd: 0.0769, twilioCallUsd: 0.2516 },
  { iso: "GB", name: "United Kingdom", region: "EUROPE", dialingCode: "44", twilioSmsUsd: 0.056, twilioCallUsd: 0.0305 },
];

// Dialing codes we recognise only to name the destination; they are all
// priced at the rest-of-world rate.
const OTHER_DIALING_CODES: readonly [string, string][] = [
  ["7", "Russia / Kazakhstan"], ["20", "Egypt"], ["27", "South Africa"],
  ["51", "Peru"], ["52", "Mexico"], ["53", "Cuba"], ["54", "Argentina"],
  ["55", "Brazil"], ["56", "Chile"], ["57", "Colombia"], ["58", "Venezuela"],
  ["60", "Malaysia"], ["61", "Australia"], ["62", "Indonesia"], ["63", "Philippines"],
  ["64", "New Zealand"], ["65", "Singapore"], ["66", "Thailand"], ["81", "Japan"],
  ["82", "South Korea"], ["84", "Vietnam"], ["86", "China"], ["90", "Turkey"],
  ["91", "India"], ["92", "Pakistan"], ["94", "Sri Lanka"], ["98", "Iran"],
  ["212", "Morocco"], ["213", "Algeria"], ["216", "Tunisia"], ["233", "Ghana"],
  ["234", "Nigeria"], ["254", "Kenya"], ["355", "Albania"], ["373", "Moldova"],
  ["374", "Armenia"], ["375", "Belarus"], ["376", "Andorra"], ["377", "Monaco"],
  ["378", "San Marino"], ["380", "Ukraine"], ["381", "Serbia"], ["382", "Montenegro"],
  ["383", "Kosovo"], ["387", "Bosnia and Herzegovina"], ["389", "North Macedonia"],
  ["423", "Liechtenstein"], ["502", "Guatemala"], ["506", "Costa Rica"],
  ["507", "Panama"], ["591", "Bolivia"], ["593", "Ecuador"], ["595", "Paraguay"],
  ["598", "Uruguay"], ["852", "Hong Kong"], ["880", "Bangladesh"], ["886", "Taiwan"],
  ["961", "Lebanon"], ["962", "Jordan"], ["964", "Iraq"], ["965", "Kuwait"],
  ["966", "Saudi Arabia"], ["968", "Oman"], ["971", "United Arab Emirates"],
  ["972", "Israel"], ["973", "Bahrain"], ["974", "Qatar"], ["977", "Nepal"],
  ["994", "Azerbaijan"], ["995", "Georgia"],
];

// North American Numbering Plan area codes that are not US or Canadian
// territory. They share +1 but are priced as rest of world by Twilio.
const NANP_OTHER_AREA_CODES: Readonly<Record<string, string>> = {
  "242": "Bahamas", "246": "Barbados", "264": "Anguilla", "268": "Antigua and Barbuda",
  "284": "British Virgin Islands", "345": "Cayman Islands", "441": "Bermuda",
  "473": "Grenada", "649": "Turks and Caicos Islands", "658": "Jamaica",
  "664": "Montserrat", "721": "Sint Maarten", "758": "Saint Lucia", "767": "Dominica",
  "784": "Saint Vincent and the Grenadines", "809": "Dominican Republic",
  "829": "Dominican Republic", "849": "Dominican Republic", "868": "Trinidad and Tobago",
  "869": "Saint Kitts and Nevis", "876": "Jamaica",
};

const CANADA_AREA_CODES = new Set([
  "204", "226", "236", "249", "250", "263", "289", "306", "343", "354", "365",
  "367", "368", "382", "387", "403", "416", "418", "428", "431", "437", "438",
  "450", "460", "468", "474", "506", "514", "519", "548", "579", "581", "584",
  "587", "604", "613", "639", "647", "672", "683", "705", "709", "742", "753",
  "778", "780", "782", "807", "819", "825", "867", "873", "879", "902", "905",
]);

const E164 = /^\+[1-9]\d{6,14}$/u;

export function priceCentsFor(usd: number, minimumCents: number): number {
  // Round the scaled value first so binary float noise (0.05 × 200 =
  // 10.000000000000002) cannot bump a price by a cent.
  const scaled = Math.round(usd * 100 * ALERT_PRICE_MARKUP * 1e6) / 1e6;
  return Math.max(minimumCents, Math.ceil(scaled));
}

export function countryPrice(rate: CountryRate): CountryPrice {
  return {
    iso: rate.iso,
    name: rate.name,
    region: rate.region,
    smsCents: priceCentsFor(rate.twilioSmsUsd, ALERT_SMS_MIN_CENTS),
    callCents: priceCentsFor(rate.twilioCallUsd, ALERT_CALL_MIN_CENTS),
  };
}

const PRICES_BY_ISO = new Map(
  PRICED_COUNTRIES.map((rate) => [rate.iso, countryPrice(rate)] as const),
);

const PRICED_BY_DIALING_CODE = new Map(
  PRICED_COUNTRIES.filter((rate) => rate.dialingCode !== "1").map(
    (rate) => [rate.dialingCode, rate] as const,
  ),
);

const OTHER_BY_DIALING_CODE = new Map(OTHER_DIALING_CODES);

export const ROW_DESTINATION: Destination = {
  iso: null,
  name: "Other country",
  region: "ROW",
};

function nanpDestination(areaCode: string): Destination {
  const other = NANP_OTHER_AREA_CODES[areaCode];
  if (other !== undefined) {
    return { iso: null, name: other, region: "ROW" };
  }
  if (CANADA_AREA_CODES.has(areaCode)) {
    return { iso: "CA", name: "Canada", region: "US_CA" };
  }
  return { iso: "US", name: "United States", region: "US_CA" };
}

/** Resolves an E.164 number to the destination used for pricing. */
export function detectDestination(phoneNumber: string): Destination {
  if (!E164.test(phoneNumber)) return ROW_DESTINATION;
  const digits = phoneNumber.slice(1);
  if (digits.startsWith("1")) return nanpDestination(digits.slice(1, 4));
  for (const length of [3, 2, 1]) {
    const code = digits.slice(0, length);
    const priced = PRICED_BY_DIALING_CODE.get(code);
    if (priced !== undefined) {
      return { iso: priced.iso, name: priced.name, region: priced.region };
    }
    const other = OTHER_BY_DIALING_CODE.get(code);
    if (other !== undefined) return { iso: null, name: other, region: "ROW" };
  }
  return ROW_DESTINATION;
}

export function quoteFor(phoneNumber: string): AlertQuote {
  const destination = detectDestination(phoneNumber);
  const priced =
    destination.iso === null ? undefined : PRICES_BY_ISO.get(destination.iso);
  if (priced === undefined) {
    return {
      destination,
      smsCents: ALERT_ROW_SMS_CENTS,
      callCents: ALERT_ROW_CALL_CENTS,
    };
  }
  return { destination, smsCents: priced.smsCents, callCents: priced.callCents };
}

export function alertUnitCents(kind: PaidAlertKind, quote: AlertQuote): number {
  return kind === "SMS" ? quote.smsCents : quote.callCents;
}

export interface PricingRegion {
  key: AlertRegion;
  name: string;
  countries: CountryPrice[];
  /** Flat prices, only for the rest-of-world region. */
  flat: { smsCents: number; callCents: number } | null;
}

export interface PricingTable {
  currency: typeof ALERT_CURRENCY;
  markup: number;
  capturedOn: string;
  regions: PricingRegion[];
}

export function pricingTable(): PricingTable {
  const byRegion = (region: AlertRegion): CountryPrice[] =>
    PRICED_COUNTRIES.filter((rate) => rate.region === region)
      .map(countryPrice)
      .sort((left, right) => left.name.localeCompare(right.name));
  return {
    currency: ALERT_CURRENCY,
    markup: ALERT_PRICE_MARKUP,
    capturedOn: PRICING_CAPTURED_ON,
    regions: [
      {
        key: "US_CA",
        name: "United States & Canada",
        countries: byRegion("US_CA"),
        flat: null,
      },
      { key: "EUROPE", name: "Europe", countries: byRegion("EUROPE"), flat: null },
      {
        key: "ROW",
        name: "Everywhere else",
        countries: [],
        flat: { smsCents: ALERT_ROW_SMS_CENTS, callCents: ALERT_ROW_CALL_CENTS },
      },
    ],
  };
}
