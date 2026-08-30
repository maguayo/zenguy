import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CustomDomainCheck, StatusPageCustomDomain } from "../../api/types";
import { ToastProvider } from "../../contexts/ToastContext";
import {
  CheckDiagnostics,
  customDomainStatusLabel,
  customDomainStatusTone,
  DnsInstructions,
  WizardStepper,
  wizardStep,
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

describe("wizardStep", () => {
  it("walks the customer through connect, dns, verify and done", () => {
    expect(wizardStep(null, null)).toBe("connect");
    expect(wizardStep(domain, null)).toBe("dns");
    expect(wizardStep(domain, check)).toBe("dns");
    expect(
      wizardStep(domain, {
        ...check,
        cname: { correct: true, found: true, value: "customers.zenguy.com" },
      }),
    ).toBe("verify");
    expect(wizardStep({ ...domain, status: "ACTIVE" }, null)).toBe("done");
    expect(wizardStep({ ...domain, status: "FAILED" }, check)).toBe("failed");
  });
});

describe("WizardStepper", () => {
  it("marks the current step and completed steps", () => {
    const html = renderToStaticMarkup(<WizardStepper step="dns" />);
    expect(html).toContain("Choose domain");
    expect(html).toContain("Add DNS record");
    expect(html).toContain("Verification");
    expect(html).toContain("bg-ok-600"); // step 1 completed
    expect(html).toContain("bg-accent-600"); // step 2 current
  });

  it("marks everything done at the end of the flow", () => {
    const html = renderToStaticMarkup(<WizardStepper step="done" />);
    expect(html.match(/bg-ok-600/gu)?.length).toBe(3);
    expect(html).not.toContain("bg-accent-600");
  });
});

describe("DnsInstructions", () => {
  it("shows the exact CNAME record with copy affordances and expectations", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <DnsInstructions
          hostname="status.example.com"
          target="customers.zenguy.com"
        />
      </ToastProvider>,
    );
    expect(html).toContain("CNAME");
    expect(html).toContain("status.example.com");
    expect(html).toContain("customers.zenguy.com");
    expect(html).toContain("Copy record name");
    expect(html).toContain("Copy record target");
    expect(html).toContain("We keep checking automatically.");
  });
});

describe("CheckDiagnostics", () => {
  it("narrates a missing CNAME and pending certificate", () => {
    const html = renderToStaticMarkup(<CheckDiagnostics check={check} />);
    expect(html).toContain("No CNAME record found yet.");
    expect(html).toContain("TLS certificate: pending_validation.");
  });

  it("narrates a wrong target and surfaces Cloudflare errors", () => {
    const html = renderToStaticMarkup(
      <CheckDiagnostics
        check={{
          ...check,
          cname: { correct: false, found: true, value: "wrong.example.net" },
          errors: ["custom hostname does not CNAME to zone"],
        }}
      />,
    );
    expect(html).toContain(
      "Your CNAME points to wrong.example.net instead of customers.zenguy.com.",
    );
    expect(html).toContain("custom hostname does not CNAME to zone");
  });

  it("celebrates a fully verified setup", () => {
    const html = renderToStaticMarkup(
      <CheckDiagnostics
        check={{
          ...check,
          cname: { correct: true, found: true, value: "customers.zenguy.com" },
          sslStatus: "active",
        }}
      />,
    );
    expect(html).toContain("DNS is correct");
    expect(html).toContain("TLS certificate issued.");
  });
});
