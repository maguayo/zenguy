import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Secret } from "../../api/types";
import {
  createSecretInput,
  replaceMetaInput,
  replaceValueInput,
  secretColumns,
  secretFormDefaults,
  secretFormSchema,
  stagingCredentialsWarning,
} from "./SecretsPage";

const secret: Secret = {
  allowedDomains: ["example.com", "*.staging.example.com"],
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: { name: "Demo User", userId: "user_1" },
  description: "Checkout account",
  id: "secret_1",
  key: "SHOP_PASSWORD",
  updatedAt: new Date(Date.now() - 60_000).toISOString(),
};

describe("secrets page", () => {
  it("keeps warning copy and metadata columns without a value column", () => {
    expect(stagingCredentialsWarning).toBe(
      "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.",
    );
    const columns = secretColumns();
    expect(columns.map((column) => column.key)).toEqual([
      "key",
      "domains",
      "description",
      "updated",
      "createdBy",
      "actions",
    ]);
    const html = renderToStaticMarkup(
      <>{columns.map((column) => <div key={column.key}>{column.render(secret)}</div>)}</>,
    );
    expect(html).toContain("SHOP_PASSWORD");
    expect(html).toContain("*.staging.example.com");
    expect(html).toContain("Checkout account");
    expect(html).toContain("Demo User");
  });

  it("validates keys, write-only values, and allowed domains", () => {
    const valid = {
      allowedDomains: ["example.com"],
      description: "QA",
      key: "SHOP_PASSWORD",
      value: "secret-value",
    };
    expect(secretFormSchema("create").safeParse(valid).success).toBe(true);
    expect(secretFormSchema("create").safeParse({ ...valid, key: "bad-key" }).success).toBe(false);
    expect(secretFormSchema("create").safeParse({ ...valid, value: "" }).success).toBe(false);
    expect(secretFormSchema("create").safeParse({ ...valid, allowedDomains: [] }).success).toBe(false);
    expect(secretFormSchema("replace").safeParse({ ...valid, value: "" }).success).toBe(false);
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
    expect(replaceValueInput(values)).toEqual({ value: "new-value" });
    expect(replaceMetaInput({ ...values, description: "" })).toEqual({
      allowedDomains: ["example.com"],
      description: null,
    });
    expect(secretFormDefaults(secret).value).toBe("");
  });
});
