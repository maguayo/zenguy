import type {
  PublicStatusPageView,
} from "../../application/status_pages/types";
import { renderStatusPage, renderStatusPageNotFound } from "./status_page_html";

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);
const CANONICAL = "https://app.zenguy.com/status/acme";

function day(date: string, downtimeSeconds: number, hasData = true) {
  return { date, downtimeSeconds, hasData };
}

function view(overrides: Partial<PublicStatusPageView> = {}): PublicStatusPageView {
  const days = Array.from({ length: 90 }, (_, index) =>
    day(`2026-06-${String((index % 28) + 1).padStart(2, "0")}`, 0),
  );
  return {
    slug: "acme",
    title: "Acme Status",
    description: "Health of Acme services",
    accentColor: "#22c55e",
    theme: "SYSTEM",
    overall: "OPERATIONAL",
    items: [
      {
        id: "spi_1",
        displayName: "Public API",
        groupName: null,
        state: "OPERATIONAL",
        uptimePercent: 99.95,
        days,
      },
    ],
    incidents: [],
    generatedAt: NOW,
    ...overrides,
  };
}

function render(v: PublicStatusPageView, preview = false): string {
  return renderStatusPage(v, { canonicalUrl: CANONICAL, preview });
}

describe("renderStatusPage", () => {
  it("escapes user-controlled text", () => {
    const html = render(
      view({
        title: '<script>alert(1)</script>',
        description: '"><img src=x onerror=alert(2)>',
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("renders the overall banner for each state", () => {
    expect(render(view())).toContain("All systems operational");
    expect(render(view({ overall: "PARTIAL_OUTAGE" }))).toContain(
      "Partial outage",
    );
    expect(render(view({ overall: "MAJOR_OUTAGE" }))).toContain("Major outage");
  });

  it("renders one bar per day with duration titles and severity classes", () => {
    const days = [
      ...Array.from({ length: 87 }, (_, index) =>
        day(`2026-06-${String((index % 28) + 1).padStart(2, "0")}`, 0),
      ),
      day("2026-08-27", 0, false),
      day("2026-08-28", 1_800),
      day("2026-08-29", 3_900),
    ];
    const html = render(
      view({
        items: [
          {
            id: "spi_1",
            displayName: "Public API",
            groupName: null,
            state: "OPERATIONAL",
            uptimePercent: 99.9,
            days,
          },
        ],
      }),
    );
    expect(html.match(/class="bar[ "]/gu)).toHaveLength(90);
    expect(html).toContain('title="2026-08-28 — 30m down"');
    expect(html).toContain('title="2026-08-29 — 1h 5m down"');
    expect(html).toContain("bar partial");
    expect(html).toContain("bar down");
    expect(html).toContain("bar nodata");
    expect(html).toContain("No downtime");
  });

  it("renders uptime percent, pending state and groups", () => {
    const html = render(
      view({
        items: [
          {
            id: "spi_1",
            displayName: "Public API",
            groupName: "Core",
            state: "OPERATIONAL",
            uptimePercent: 99.95,
            days: [day("2026-08-29", 0)],
          },
          {
            id: "spi_2",
            displayName: "Checkout flow",
            groupName: "Core",
            state: "PENDING",
            uptimePercent: null,
            days: [day("2026-08-29", 0, false)],
          },
          {
            id: "spi_3",
            displayName: "Docs",
            groupName: null,
            state: "DOWN",
            uptimePercent: 90,
            days: [day("2026-08-29", 3_600)],
          },
        ],
      }),
    );
    expect(html).toContain("99.95%");
    expect(html).toContain("No data yet");
    expect(html.match(/>Core</gu)).toHaveLength(1);
    expect(html.indexOf("Docs")).toBeLessThan(html.indexOf("Public API"));
  });

  it("renders incidents with durations and escaped updates", () => {
    const html = render(
      view({
        incidents: [
          {
            displayName: "Public API",
            status: "ONGOING",
            startedAt: NOW - 3_600_000,
            resolvedAt: null,
            durationSeconds: 3_600,
            updates: [
              {
                message: "<b>Investigating</b> elevated errors",
                createdAt: NOW - 1_800_000,
              },
            ],
          },
          {
            displayName: "Docs",
            status: "RESOLVED",
            startedAt: NOW - 90_000_000,
            resolvedAt: NOW - 86_400_000,
            durationSeconds: 3_600_000 / 1_000,
            updates: [],
          },
        ],
      }),
    );
    expect(html).toContain("Ongoing");
    expect(html).toContain("Resolved");
    expect(html).not.toContain("<b>Investigating</b>");
    expect(html).toContain("&lt;b&gt;Investigating&lt;/b&gt;");
  });

  it("adds meta refresh, canonical, viewport and OG tags on the live page", () => {
    const html = render(view());
    expect(html).toContain('<meta http-equiv="refresh" content="60">');
    expect(html).toContain(`<link rel="canonical" href="${CANONICAL}">`);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    expect(html).toContain('property="og:title" content="Acme Status"');
    expect(html).toContain(
      'property="og:description" content="All systems operational"',
    );
    expect(html).toContain(`property="og:url" content="${CANONICAL}"`);
  });

  it("omits the meta refresh in preview mode", () => {
    const html = render(view(), true);
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it("shows the Powered by Zenguy badge", () => {
    const html = render(view());
    expect(html).toContain("Powered by Zenguy");
    expect(html).toContain("https://zenguy.com?utm_source=status_page");
  });

  it("applies only a validated accent color", () => {
    const valid = render(view({ accentColor: "#123abc" }));
    expect(valid).toContain("#123abc");
    const invalid = render(
      view({ accentColor: "red;}body{background:url(evil)" }),
    );
    expect(invalid).not.toContain("evil");
    const none = render(view({ accentColor: null }));
    expect(none).toContain("<style>");
  });

  it("never leaks undefined or null into the output", () => {
    const html = render(view({ description: null, accentColor: null }));
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });
});

describe("renderStatusPageNotFound", () => {
  it("returns a generic page with no hints", () => {
    const html = renderStatusPageNotFound();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Status page not found");
    expect(html).not.toContain("draft");
  });
});
