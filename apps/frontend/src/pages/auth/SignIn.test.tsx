import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthShell } from "../../components/AuthShell";
import {
  GoogleSignInOption,
  googleAuthErrorMessage,
  signInSchema,
} from "./SignIn";

describe("sign-in screen", () => {
  it("validates email format and a required password", () => {
    const result = signInSchema.safeParse({ email: "invalid", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual([
        "Enter a valid email address.",
        "Password is required.",
      ]);
    }
  });

  it("accepts a valid sign-in payload", () => {
    expect(
      signInSchema.safeParse({ email: "maria@example.com", password: "secret" }).success,
    ).toBe(true);
  });

  it("renders the shared auth shell hierarchy", () => {
    const html = renderToStaticMarkup(
      <AuthShell footer="Footer" title="Sign in">
        Form
      </AuthShell>,
    );
    expect(html).toContain("zenguy");
    expect(html).toContain("Sign in");
    expect(html).toContain("Footer");
  });

  it("renders an accessible Google option without an external script", () => {
    const html = renderToStaticMarkup(<GoogleSignInOption />);

    expect(html).toContain('type="button"');
    expect(html).toContain("Continue with Google");
    expect(html).toContain("or continue with email");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('role="separator"');
  });

  it("maps only known OAuth errors to safe messages", () => {
    expect(googleAuthErrorMessage("cancelled")).toBe(
      "Google sign-in was cancelled. You can try again.",
    );
    expect(googleAuthErrorMessage("link_required")).toContain("couldn't safely match");
    expect(googleAuthErrorMessage("<script>alert(1)</script>")).toBeNull();
    expect(googleAuthErrorMessage(null)).toBeNull();
  });
});
