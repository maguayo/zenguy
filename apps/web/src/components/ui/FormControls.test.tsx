import { renderToStaticMarkup } from "react-dom/server";
import type { FormState } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { Field } from "./Field";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { Toggle } from "./Toggle";
import { fieldError } from "./form";

describe("form controls", () => {
  it("marks invalid inputs accessibly", () => {
    const html = renderToStaticMarkup(<Input invalid name="email" />);

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("border-danger-600");
  });

  it("gives instruction textareas the documented minimum height", () => {
    expect(renderToStaticMarkup(<Textarea />)).toContain("min-h-28");
  });

  it("associates labels and renders errors as alerts", () => {
    const html = renderToStaticMarkup(
      <Field error="Email is required" htmlFor="email" label="Email" required>
        <Input id="email" />
      </Field>,
    );

    expect(html).toContain('for="email"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Email is required");
  });

  it("exposes toggle state with switch semantics", () => {
    const html = renderToStaticMarkup(
      <Toggle aria-label="Notify on recovery" checked />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
  });

  it("extracts nested react-hook-form errors", () => {
    type Values = { profile: { name: string } };
    const state = {
      errors: { profile: { name: { type: "required", message: "Required" } } },
    } as Pick<FormState<Values>, "errors">;

    expect(fieldError(state, "profile.name")).toBe("Required");
  });
});
