import { describe, expect, it } from "@jest/globals";

import type { Secret } from "@/api/types";
import {
  createSecretInput,
  deleteSecretTitle,
  replaceMetaInput,
  replaceValueInput,
  secretFieldErrors,
  secretFormDefaults,
  secretFormFields,
  secretFormSchema,
  secretFormSubmitLabel,
  secretFormTitle,
  secretSavedMessage,
  stagingCredentialsWarning,
} from "./secret-form";

const secret: Secret = {
  allowedDomains: ["example.com", "*.staging.example.com"],
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: { name: "Demo User", userId: "user_1" },
  description: "Checkout account",
  id: "secret_1",
  key: "SHOP_PASSWORD",
  updatedAt: "2026-08-19T10:30:00.000Z",
};

const valid = {
  allowedDomains: ["example.com"],
  description: "QA",
  key: "SHOP_PASSWORD",
  value: "secret-value",
};

describe("secret form", () => {
  it("keeps the staging credentials warning copy", () => {
    expect(stagingCredentialsWarning).toBe(
      "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.",
    );
  });

  it("validates keys, write-only values, and allowed domains", () => {
    expect(secretFormSchema("create").safeParse(valid).success).toBe(true);
    expect(secretFormSchema("create").safeParse({ ...valid, key: "bad-key" }).success).toBe(false);
    expect(secretFormSchema("create").safeParse({ ...valid, key: "A" }).success).toBe(false);
    expect(secretFormSchema("create").safeParse({ ...valid, key: "1ABC" }).success).toBe(false);
    expect(secretFormSchema("create").safeParse({ ...valid, value: "" }).success).toBe(false);
    expect(secretFormSchema("create").safeParse({ ...valid, value: "x".repeat(4_097) }).success).toBe(false);
    expect(secretFormSchema("create").safeParse({ ...valid, allowedDomains: [] }).success).toBe(false);
    expect(
      secretFormSchema("create").safeParse({ ...valid, allowedDomains: ["https://example.com"] }).success,
    ).toBe(false);
    expect(secretFormSchema("replace").safeParse({ ...valid, value: "" }).success).toBe(false);
  });

  it("surfaces the web's messages on the offending field", () => {
    const result = secretFormSchema("create").safeParse({ ...valid, allowedDomains: [], key: "bad" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["key", "Use 2–64 uppercase letters, numbers, or underscores."],
      ["allowedDomains", "Add between 1 and 20 allowed domains."],
    ]);
  });

  it("only validates the fields each mode shows", () => {
    expect(secretFormSchema("replace").safeParse({ ...valid, allowedDomains: [], key: "" }).success).toBe(true);
    expect(secretFormSchema("meta").safeParse({ ...valid, key: "", value: "" }).success).toBe(true);
    expect(secretFormSchema("meta").safeParse({ ...valid, allowedDomains: [] }).success).toBe(false);
    expect(secretFormFields("create")).toEqual(["key", "value", "allowedDomains", "description"]);
    expect(secretFormFields("replace")).toEqual(["value"]);
    expect(secretFormFields("meta")).toEqual(["allowedDomains", "description"]);
  });

  it("builds create, replace-value, and metadata payloads without reading an old value", () => {
    const values = {
      allowedDomains: ["example.com"],
      description: " QA account ",
      key: "SHOP_PASSWORD",
      value: "new-value",
    };
    expect(createSecretInput(values)).toEqual({
      allowedDomains: ["example.com"],
      description: "QA account",
      key: "SHOP_PASSWORD",
      value: "new-value",
    });
    expect(createSecretInput({ ...values, description: "  " })).toEqual({
      allowedDomains: ["example.com"],
      key: "SHOP_PASSWORD",
      value: "new-value",
    });
    expect(replaceValueInput(values)).toEqual({ value: "new-value" });
    expect(replaceMetaInput({ ...values, description: "" })).toEqual({
      allowedDomains: ["example.com"],
      description: null,
    });
    expect(secretFormDefaults(secret)).toEqual({
      allowedDomains: ["example.com", "*.staging.example.com"],
      description: "Checkout account",
      key: "SHOP_PASSWORD",
      value: "",
    });
    expect(secretFormDefaults()).toEqual({ allowedDomains: [], description: "", key: "", value: "" });
  });

  it("keeps the web's titles, button labels, toasts, and delete prompt", () => {
    expect(secretFormTitle("create")).toBe("Add secret");
    expect(secretFormTitle("replace", secret)).toBe("Replace {{SHOP_PASSWORD}}");
    expect(secretFormTitle("meta", secret)).toBe("Edit {{SHOP_PASSWORD}}");
    expect(secretFormTitle("meta")).toBe("Edit {{SECRET}}");
    expect(secretFormSubmitLabel("create")).toBe("Add secret");
    expect(secretFormSubmitLabel("replace")).toBe("Replace value");
    expect(secretFormSubmitLabel("meta")).toBe("Save changes");
    expect(secretSavedMessage("create")).toBe("Secret created");
    expect(secretSavedMessage("replace")).toBe("Secret value replaced");
    expect(secretSavedMessage("meta")).toBe("Secret updated");
    expect(deleteSecretTitle(secret)).toBe("Delete {{SHOP_PASSWORD}}?");
  });

  it("maps API details onto visible fields only, first message per field", () => {
    const details = [
      { field: "allowedDomains.1", message: "Invalid domain" },
      { field: "allowedDomains", message: "Too many" },
      { field: "value", message: "Too long" },
      { field: "workspaceId", message: "Unknown" },
    ];
    expect(secretFieldErrors(details, secretFormFields("create"))).toEqual([
      { field: "allowedDomains", message: "Invalid domain" },
      { field: "value", message: "Too long" },
    ]);
    expect(secretFieldErrors(details, secretFormFields("replace"))).toEqual([
      { field: "value", message: "Too long" },
    ]);
    expect(secretFieldErrors(undefined, secretFormFields("create"))).toEqual([]);
  });
});
