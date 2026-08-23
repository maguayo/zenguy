import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Freshness } from "./DashboardPage";

describe("dashboard freshness", () => {
  it("reports the age of the oldest section still on screen", () => {
    const html = renderToStaticMarkup(<Freshness stale={false} updatedAt={Date.now() - 4_000} />);
    expect(html).toContain("Production · updated 4s ago");
  });

  it("says nothing about freshness before the first answer arrives", () => {
    const html = renderToStaticMarkup(<Freshness stale={false} updatedAt={0} />);
    expect(html).toContain("Production · connecting…");
  });

  it("warns when a background refetch has failed", () => {
    const html = renderToStaticMarkup(<Freshness stale updatedAt={Date.now() - 4_000} />);
    expect(html).toContain("Some sections are stale");
    expect(html).not.toContain("updated 4s ago");
  });
});
