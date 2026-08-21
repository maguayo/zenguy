import {
  ALERT_CALL_MIN_CENTS,
  ALERT_ROW_CALL_CENTS,
  ALERT_ROW_SMS_CENTS,
  ALERT_SMS_MIN_CENTS,
  PRICED_COUNTRIES,
  alertUnitCents,
  countryPrice,
  detectDestination,
  priceCentsFor,
  pricingTable,
  quoteFor,
} from "./pricing";

describe("alert pricing", () => {
  it("applies the markup, rounds up to the cent, and enforces minimums", () => {
    expect(priceCentsFor(0.0875, ALERT_SMS_MIN_CENTS)).toBe(18);
    expect(priceCentsFor(0.112, ALERT_SMS_MIN_CENTS)).toBe(23);
    expect(priceCentsFor(0.0133, ALERT_SMS_MIN_CENTS)).toBe(5);
    expect(priceCentsFor(0.05, ALERT_SMS_MIN_CENTS)).toBe(10);
    expect(priceCentsFor(0.0486, ALERT_CALL_MIN_CENTS)).toBe(20);
    expect(priceCentsFor(0.2763, ALERT_CALL_MIN_CENTS)).toBe(56);
    expect(priceCentsFor(0.6633, ALERT_CALL_MIN_CENTS)).toBe(133);
  });

  it("prices every listed country above Twilio's cost", () => {
    for (const rate of PRICED_COUNTRIES) {
      const price = countryPrice(rate);
      expect(price.smsCents).toBeGreaterThan(rate.twilioSmsUsd * 100);
      expect(price.callCents).toBeGreaterThan(rate.twilioCallUsd * 100);
      expect(price.smsCents).toBeGreaterThanOrEqual(ALERT_SMS_MIN_CENTS);
      expect(price.callCents).toBeGreaterThanOrEqual(ALERT_CALL_MIN_CENTS);
    }
  });

  it("detects destinations by longest dialing prefix", () => {
    expect(detectDestination("+34612345678")).toEqual({
      iso: "ES",
      name: "Spain",
      region: "EUROPE",
    });
    expect(detectDestination("+351912345678").iso).toBe("PT");
    expect(detectDestination("+35312345678").iso).toBe("IE");
    expect(detectDestination("+447700900123").iso).toBe("GB");
    expect(detectDestination("+4915123456789").iso).toBe("DE");
    expect(detectDestination("+12025550123")).toEqual({
      iso: "US",
      name: "United States",
      region: "US_CA",
    });
    expect(detectDestination("+14165550123")).toEqual({
      iso: "CA",
      name: "Canada",
      region: "US_CA",
    });
  });

  it("sends Caribbean NANP numbers and unknown prefixes to rest of world", () => {
    expect(detectDestination("+18765550123")).toEqual({
      iso: null,
      name: "Jamaica",
      region: "ROW",
    });
    expect(detectDestination("+5215512345678")).toEqual({
      iso: null,
      name: "Mexico",
      region: "ROW",
    });
    expect(detectDestination("+2125512345678").name).toBe("Morocco");
    expect(detectDestination("+99912345678")).toEqual({
      iso: null,
      name: "Other country",
      region: "ROW",
    });
    expect(detectDestination("not-a-number").region).toBe("ROW");
  });

  it("quotes per-country prices and flat rest-of-world prices", () => {
    expect(quoteFor("+34612345678")).toEqual({
      destination: { iso: "ES", name: "Spain", region: "EUROPE" },
      smsCents: 18,
      callCents: 20,
    });
    expect(quoteFor("+12025550123")).toMatchObject({ smsCents: 5, callCents: 20 });
    expect(quoteFor("+31612345678")).toMatchObject({ smsCents: 23, callCents: 56 });
    expect(quoteFor("+5215512345678")).toMatchObject({
      smsCents: ALERT_ROW_SMS_CENTS,
      callCents: ALERT_ROW_CALL_CENTS,
    });
    const quote = quoteFor("+34612345678");
    expect(alertUnitCents("SMS", quote)).toBe(18);
    expect(alertUnitCents("CALL", quote)).toBe(20);
  });

  it("builds a pricing table grouped by region with sorted countries", () => {
    const table = pricingTable();
    expect(table.currency).toBe("EUR");
    expect(table.regions.map((region) => region.key)).toEqual([
      "US_CA",
      "EUROPE",
      "ROW",
    ]);
    const europe = table.regions[1]!;
    expect(europe.countries.map((country) => country.name)).toEqual(
      [...europe.countries.map((country) => country.name)].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
    expect(europe.countries).toHaveLength(31);
    expect(europe.countries.find((country) => country.iso === "ES")).toEqual({
      iso: "ES",
      name: "Spain",
      region: "EUROPE",
      smsCents: 18,
      callCents: 20,
    });
    expect(table.regions[2]).toMatchObject({
      key: "ROW",
      countries: [],
      flat: { smsCents: ALERT_ROW_SMS_CENTS, callCents: ALERT_ROW_CALL_CENTS },
    });
  });
});
