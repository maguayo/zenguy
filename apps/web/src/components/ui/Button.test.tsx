import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Spinner } from "./Spinner";

describe("button primitives", () => {
  it("renders a secondary button with button semantics by default", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);

    expect(html).toContain('type="button"');
    expect(html).toContain("border-zinc-300");
    expect(html).toContain(">Save</button>");
  });

  it("disables and labels a loading primary button", () => {
    const html = renderToStaticMarkup(
      <Button loading variant="primary">
        Save
      </Button>,
    );

    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Loading"');
    expect(html).toContain("bg-accent-600");
  });

  it("requires an accessible name for icon buttons", () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Close">×</IconButton>,
    );

    expect(html).toContain('aria-label="Close"');
  });

  it("supports each documented spinner size", () => {
    for (const size of [4, 5, 6] as const) {
      expect(renderToStaticMarkup(<Spinner size={size} />)).toContain(
        `size-${size}`,
      );
    }
  });
});
