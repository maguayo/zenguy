import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "./AuthContext";

describe("AuthProvider", () => {
  it("renders a full-screen loading state without flashing children", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AuthProvider>
          <p>Private application</p>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(html).toContain('aria-label="Loading Zenguy"');
    expect(html).not.toContain("Private application");
  });
});
