import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LogoMark } from "./LogoMark";

describe("LogoMark", () => {
  it("renders the official decorative brand mark", () => {
    const html = renderToStaticMarkup(<LogoMark className="size-6" />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('viewBox="0 0 32 32"');
    expect(html).toContain('class="size-6"');
    expect(html).toContain('fill="#14110D"');
    expect(html).toContain('fill="#615ED6"');
  });
});
