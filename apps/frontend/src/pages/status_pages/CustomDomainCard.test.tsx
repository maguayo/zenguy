import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CustomDomainCheck, StatusPageCustomDomain } from "../../api/types";
import { ToastProvider } from "../../contexts/ToastContext";
import {
  CustomDomainDetails,
  customDomainStatusLabel,
  customDomainStatusTone,
} from "./CustomDomainCard";

const domain: StatusPageCustomDomain = {
  checkedAt: "2026-08-30T10:00:00.000Z",
  hostname: "status.example.com",
  status: "PENDING",
};

const check: CustomDomainCheck = {
  cname: { correct: false, found: false, value: null },
  cnameTarget: "customers.zenguy.com",
  domain: "status.example.com",
  errors: [],
  hostnameStatus: "pending",
  sslStatus: "pending_validation",
  status: "PENDING",
};

function render(
  input: StatusPageCustomDomain,
  checkResult: CustomDomainCheck | null,
): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <CustomDomainDetails check={checkResult} domain={input} />
    </ToastProvider>,
  );
}

describe("custom domain status", () => {
  it("maps statuses to labels and badge tones", () => {
    expect(customDomainStatusLabel("PENDING")).toBe("Pending");
    expect(customDomainStatusLabel("ACTIVE")).toBe("Active");
    expect(customDomainStatusLabel("FAILED")).toBe("Failed");
    expect(customDomainStatusTone("PENDING")).toBe("warn");
    expect(customDomainStatusTone("ACTIVE")).toBe("ok");
    expect(customDomainStatusTone("FAILED")).toBe("danger");
  });
});

describe("CustomDomainDetails", () => {
  it("shows the CNAME instructions while pending, with diagnostics", () => {
    const html = render(domain, check);
    expect(html).toContain("status.example.com");
    expect(html).toContain("Pending");
    expect(html).toContain("CNAME");
    expect(html).toContain("customers.zenguy.com");
    expect(html).toContain("No CNAME record found yet");
    expect(html).toContain("Certificate: pending_validation.");
    expect(html).not.toContain(">Open<");
  });

  it("reports a wrong CNAME target and Cloudflare errors", () => {
    const html = render(domain, {
      ...check,
      cname: { correct: false, found: true, value: "wrong.example.net" },
      errors: ["custom hostname does not CNAME to zone"],
    });
    expect(html).toContain(
      "Your CNAME points to wrong.example.net instead of customers.zenguy.com.",
    );
    expect(html).toContain("custom hostname does not CNAME to zone");
  });

  it("hides the instructions and links out once active", () => {
    const html = render(
      { ...domain, status: "ACTIVE" },
      {
        ...check,
        cname: { correct: true, found: true, value: "customers.zenguy.com" },
        sslStatus: "active",
        status: "ACTIVE",
      },
    );
    expect(html).toContain("Active");
    expect(html).toContain("https://status.example.com/");
    expect(html).toContain("DNS looks good");
    expect(html).toContain("Certificate issued.");
    expect(html).not.toContain("Create this DNS record");
  });
});
