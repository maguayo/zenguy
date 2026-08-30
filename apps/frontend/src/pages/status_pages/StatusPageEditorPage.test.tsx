import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { StatusPageDetail, StatusPageItem } from "../../api/types";
import {
  changedPageFields,
  EditorItemRow,
  moveId,
  settingsFromPage,
} from "./StatusPageEditorPage";

const page: StatusPageDetail = {
  accentColor: "#22c55e",
  createdAt: "2026-08-30T10:00:00.000Z",
  customDomain: null,
  description: "Health of Acme services",
  id: "sp_1",
  items: [],
  publishedAt: null,
  slug: "acme",
  theme: "SYSTEM",
  title: "Acme Status",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

const item: StatusPageItem = {
  displayName: "Public API",
  groupName: "Core",
  id: "spi_1",
  position: 0,
  resourceId: "mon_1",
  resourceType: "UPTIME_MONITOR",
};

describe("settingsFromPage / changedPageFields", () => {
  it("round-trips a page into the form with empty-string fallbacks", () => {
    expect(settingsFromPage({ ...page, accentColor: null, description: null })).toEqual({
      accentColor: "",
      description: "",
      slug: "acme",
      theme: "SYSTEM",
      title: "Acme Status",
    });
  });

  it("returns only the fields that changed, normalized for the API", () => {
    const form = settingsFromPage(page);
    expect(changedPageFields(page, form)).toEqual({});
    expect(
      changedPageFields(page, { ...form, title: "  Acme Cloud  " }),
    ).toEqual({ title: "Acme Cloud" });
    expect(changedPageFields(page, { ...form, description: "  " })).toEqual({
      description: null,
    });
    expect(changedPageFields(page, { ...form, accentColor: "" })).toEqual({
      accentColor: null,
    });
    expect(
      changedPageFields(page, { ...form, accentColor: "#ABCDEF" }),
    ).toEqual({ accentColor: "#abcdef" });
    expect(
      changedPageFields(page, { ...form, slug: "acme-cloud", theme: "DARK" }),
    ).toEqual({ slug: "acme-cloud", theme: "DARK" });
  });
});

describe("moveId", () => {
  it("swaps neighbours and ignores out-of-range moves", () => {
    expect(moveId(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("EditorItemRow", () => {
  function render(manage: boolean, input: StatusPageItem = item): string {
    return renderToStaticMarkup(
      <EditorItemRow
        first
        item={input}
        last={false}
        manage={manage}
        onMove={() => undefined}
        onRemove={() => undefined}
        onRename={() => undefined}
      />,
    );
  }

  it("renders the resource kind, editable names and reorder controls", () => {
    const html = render(true);
    expect(html).toContain("Monitor");
    expect(html).toContain('value="Public API"');
    expect(html).toContain('value="Core"');
    expect(html).toContain('aria-label="Move Public API up"');
    expect(html).toContain('aria-label="Move Public API down"');
    expect(html).toContain('aria-label="Remove Public API"');
    expect(html).toContain("disabled"); // first => up disabled
  });

  it("labels browser tests and hides controls for read-only members", () => {
    const html = render(false, {
      ...item,
      groupName: null,
      resourceType: "BROWSER_TEST",
    });
    expect(html).toContain("Browser test");
    expect(html).not.toContain("Move Public API up");
    expect(html).not.toContain("Remove Public API");
    expect(html).toContain("disabled"); // inputs read-only
  });
});
