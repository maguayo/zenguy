import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "../lib/errors";
import {
  ToastProvider,
  appendToast,
  useToast,
  type ToastItem,
} from "./ToastContext";

function UsesToast() {
  useToast();
  return null;
}

describe("toast context", () => {
  it("keeps only the four newest toasts", () => {
    let items: ToastItem[] = [];
    for (let id = 1; id <= 5; id += 1) {
      items = appendToast(items, { id, message: String(id), tone: "success" });
    }

    expect(items.map((item) => item.id)).toEqual([2, 3, 4, 5]);
  });

  it("accepts informational toasts", () => {
    expect(appendToast([], { id: 1, message: "Continue in Stripe", tone: "info" })).toEqual([
      { id: 1, message: "Continue in Stripe", tone: "info" },
    ]);
  });

  it("renders an aria-live toast region", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <p>Application</p>
      </ToastProvider>,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Application");
  });

  it("requires the provider", () => {
    expect(() => renderToStaticMarkup(<UsesToast />)).toThrow(
      "useToast must be used within ToastProvider",
    );
  });

  it("extracts API messages and falls back safely", () => {
    expect(apiErrorMessage(new Error("Already exists"))).toBe("Already exists");
    expect(apiErrorMessage({ message: "Invalid value" })).toBe("Invalid value");
    expect(apiErrorMessage(null)).toBe("Something went wrong");
  });
});
