import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Freshness, oldestUpdate } from "./Freshness";

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

describe("oldestUpdate", () => {
  it("takes the age of the oldest section that answered", () => {
    expect(oldestUpdate([{ dataUpdatedAt: 300 }, { dataUpdatedAt: 100 }])).toBe(100);
  });

  it("ignores a query serving a placeholder it has never fetched", () => {
    // Switching the range hands the new query the old range's data with
    // dataUpdatedAt 0; counting it would report "connecting…" over live numbers.
    expect(oldestUpdate([{ dataUpdatedAt: 0 }, { dataUpdatedAt: 100 }])).toBe(100);
  });

  it("has no age to report before anything has answered", () => {
    expect(oldestUpdate([{ dataUpdatedAt: 0 }])).toBe(0);
    expect(oldestUpdate([])).toBe(0);
  });
});
