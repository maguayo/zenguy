import { describe, expect, it } from "vitest";

import { trustedBillingUrl } from "./billing-links";

describe("trusted billing links", () => {
  it("allows exact Paddle portal and invoice hosts over HTTPS", () => {
    expect(trustedBillingUrl("https://customer-portal.paddle.com/cpl_123")).toBe(
      "https://customer-portal.paddle.com/cpl_123",
    );
    expect(trustedBillingUrl("https://sandbox-invoicedata.paddle.com/invoice/1.pdf")).toBe(
      "https://sandbox-invoicedata.paddle.com/invoice/1.pdf",
    );
  });

  it.each([
    "http://customer-portal.paddle.com/cpl_123",
    "https://customer-portal.paddle.com.evil.test/cpl_123",
    "https://evil.test/?next=customer-portal.paddle.com",
    "javascript:alert(1)",
    "https://user:pass@customer-portal.paddle.com/cpl_123",
    "https://customer-portal.paddle.com:444/cpl_123",
  ])("rejects an untrusted billing target: %s", (url) => {
    expect(trustedBillingUrl(url)).toBeNull();
  });
});
