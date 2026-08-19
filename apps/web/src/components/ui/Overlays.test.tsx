import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";
import { nextMenuIndex } from "./Dropdown";
import { Tooltip } from "./Tooltip";

describe("overlay primitives", () => {
  it("wraps and skips disabled dropdown items", () => {
    const items = [{ disabled: false }, { disabled: true }, { disabled: false }];

    expect(nextMenuIndex(0, 1, items)).toBe(2);
    expect(nextMenuIndex(2, 1, items)).toBe(0);
    expect(nextMenuIndex(0, -1, items)).toBe(2);
  });

  it("returns no menu target when every item is disabled", () => {
    expect(nextMenuIndex(-1, 1, [{ disabled: true }])).toBe(-1);
  });

  it("exposes tooltip content to assistive technology", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="An explanation">Target</Tooltip>,
    );

    expect(html).toContain('role="tooltip"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain("An explanation");
  });

  it("does not render a closed confirmation dialog", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        body="This cannot be undone."
        onClose={() => undefined}
        onConfirm={() => undefined}
        open={false}
        title="Delete?"
      />,
    );

    expect(html).toBe("");
  });
});
