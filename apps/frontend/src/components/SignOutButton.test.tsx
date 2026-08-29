import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignOutButton } from "./SignOutButton";

describe("SignOutButton", () => {
  it("renders a sign-out action that cannot submit an enclosing form", () => {
    const html = renderToStaticMarkup(<SignOutButton onSignOut={() => undefined} />);
    expect(html).toContain("Sign out");
    expect(html).toContain('type="button"');
  });
});
