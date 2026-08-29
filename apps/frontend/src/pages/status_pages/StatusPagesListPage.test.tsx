import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { StatusPage } from "../../api/types";
import { ToastProvider } from "../../contexts/ToastContext";
import {
  StatusPageRowContent,
  statusPageUrl,
  suggestSlug,
} from "./StatusPagesListPage";

const page: StatusPage = {
  accentColor: null,
  createdAt: "2026-08-30T10:00:00.000Z",
  description: null,
  id: "sp_1",
  publishedAt: null,
  slug: "acme",
  theme: "SYSTEM",
  title: "Acme Status",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

describe("suggestSlug", () => {
  it("derives a url-safe slug from the title", () => {
    expect(suggestSlug("Acme  Status!! 2026")).toBe("acme-status-2026");
    expect(suggestSlug("  --Wéird ñame--  ")).toBe("w-ird-ame");
    expect(suggestSlug("a".repeat(80))).toHaveLength(63);
    expect(suggestSlug("")).toBe("");
  });
});

describe("statusPageUrl", () => {
  it("builds the public URL from the origin and slug", () => {
    expect(statusPageUrl("https://app.zenguy.com", "acme")).toBe(
      "https://app.zenguy.com/status/acme",
    );
  });
});

describe("StatusPageRowContent", () => {
  function render(input: StatusPage): string {
    return renderToStaticMarkup(
      <MemoryRouter>
        <ToastProvider>
          <StatusPageRowContent
            origin="https://app.zenguy.com"
            page={input}
            workspaceId="ws_1"
          />
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  it("renders the title link, public URL and draft badge", () => {
    const html = render(page);
    expect(html).toContain("/w/ws_1/status-pages/sp_1");
    expect(html).toContain("Acme Status");
    expect(html).toContain("https://app.zenguy.com/status/acme");
    expect(html).toContain("Draft");
    expect(html).not.toContain("Published");
    expect(html).not.toContain("Open Acme Status in a new tab");
  });

  it("shows the published badge and external link once published", () => {
    const html = render({ ...page, publishedAt: "2026-08-30T11:00:00.000Z" });
    expect(html).toContain("Published");
    expect(html).not.toContain(">Draft<");
    expect(html).toContain("Open Acme Status in a new tab");
  });
});
