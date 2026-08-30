import { billingCurrencyForRequest } from "./billing_currency";

function requestWithCf(cf?: {
  isEUCountry?: string | boolean | null;
  country?: string | null;
}): Request {
  const request = new Request("https://api.example.test");
  if (cf !== undefined) Object.defineProperty(request, "cf", { value: cf });
  return request;
}

describe("billingCurrencyForRequest", () => {
  it("prefers Cloudflare's EU signal", () => {
    expect(billingCurrencyForRequest(requestWithCf({
      isEUCountry: "1",
      country: "US",
    }))).toBe("EUR");
    expect(billingCurrencyForRequest(requestWithCf({
      isEUCountry: false,
      country: "ES",
    }))).toBe("USD");
  });

  it("falls back to Cloudflare country metadata and header", () => {
    expect(billingCurrencyForRequest(requestWithCf({ country: "es" }))).toBe(
      "EUR",
    );
    expect(billingCurrencyForRequest(requestWithCf({ country: "gb" }))).toBe(
      "USD",
    );
    expect(billingCurrencyForRequest(new Request("https://api.example.test", {
      headers: { "CF-IPCountry": "US" },
    }))).toBe("USD");
  });

  it("keeps EUR when local development has no location signal", () => {
    expect(billingCurrencyForRequest(requestWithCf())).toBe("EUR");
  });
});
