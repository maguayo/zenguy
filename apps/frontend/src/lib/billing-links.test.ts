import { describe, expect, it } from "vitest";

import { trustedBillingUrl } from "./billing-links";

describe("trusted billing links", () => {
  it("allows exact Stripe checkout, portal, and invoice hosts over HTTPS", () => {
    expect(trustedBillingUrl("https://checkout.stripe.com/c/pay/cs_123")).toBe(
      "https://checkout.stripe.com/c/pay/cs_123",
    );
    expect(trustedBillingUrl("https://billing.stripe.com/p/session/123")).toBe(
      "https://billing.stripe.com/p/session/123",
    );
    expect(trustedBillingUrl("https://invoice.stripe.com/i/acct_1/test.pdf")).toBe(
      "https://invoice.stripe.com/i/acct_1/test.pdf",
    );
  });

  it.each([
    "http://checkout.stripe.com/c/pay/cs_123",
    "https://checkout.stripe.com.evil.test/c/pay/cs_123",
    "https://evil.test/?next=checkout.stripe.com",
    "javascript:alert(1)",
    "https://user:pass@checkout.stripe.com/c/pay/cs_123",
    "https://checkout.stripe.com:444/c/pay/cs_123",
    "https://customer-portal.paddle.com/cpl_123",
  ])("rejects an untrusted billing target: %s", (url) => {
    expect(trustedBillingUrl(url)).toBeNull();
  });
});
