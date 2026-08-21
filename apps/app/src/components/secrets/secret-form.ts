import { z } from "zod";

import type { CreateSecretInput, ReplaceSecretInput } from "@/api/secrets";
import type { Secret } from "@/api/types";
import type { ApiErrorDetail } from "@/lib/api";

import { isAllowedDomain } from "./domains";

// Copy ported verbatim from apps/frontend/src/pages/secrets/SecretsPage.tsx.
export const stagingCredentialsWarning =
  "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.";
export const secretsIntro =
  "Store credentials once, encrypted, and reference them in tests as {{KEY}}.";
export const secretsWriteOnlyNote = "Values can't be viewed once saved — only replaced.";
export const secretKeyHint =
  "Uppercase letters, digits and _ — e.g. SHOP_PASSWORD. Use it in instructions as {{SHOP_PASSWORD}}.";
export const secretValueHint = "You won't be able to view this value again — only replace it.";
export const secretReplaceNote =
  "The current value can't be viewed. Entering a new value replaces it immediately.";
export const secretDomainsHint =
  "example.com matches only that host. *.example.com also matches its subdomains. Secrets are only ever typed on these domains.";
export const secretKeyConflictMessage = "A secret with this key already exists.";
export const deleteSecretWarning = "Tests that reference it will start failing.";

export type SecretFormMode = "create" | "replace" | "meta";

const secretFormBase = z.object({
  allowedDomains: z.array(z.string()),
  description: z.string(),
  key: z.string(),
  value: z.string(),
});

export type SecretFormValues = z.infer<typeof secretFormBase>;
export type SecretFormField = keyof SecretFormValues;

export function secretFormSchema(mode: SecretFormMode) {
  return secretFormBase.superRefine((values, context) => {
    if (mode === "create" && !/^[A-Z][A-Z0-9_]{1,63}$/u.test(values.key)) {
      context.addIssue({
        code: "custom",
        message: "Use 2–64 uppercase letters, numbers, or underscores.",
        path: ["key"],
      });
    }
    if (
      (mode === "create" || mode === "replace") &&
      (values.value.length < 1 || values.value.length > 4_096)
    ) {
      context.addIssue({
        code: "custom",
        message: "Value must be between 1 and 4096 characters.",
        path: ["value"],
      });
    }
    if (mode === "create" || mode === "meta") {
      if (values.allowedDomains.length < 1 || values.allowedDomains.length > 20) {
        context.addIssue({
          code: "custom",
          message: "Add between 1 and 20 allowed domains.",
          path: ["allowedDomains"],
        });
      } else if (values.allowedDomains.some((domain) => !isAllowedDomain(domain))) {
        context.addIssue({
          code: "custom",
          message: "Each allowed domain must be a hostname or wildcard.",
          path: ["allowedDomains"],
        });
      }
    }
  });
}

/** The fields the form shows — and accepts API field errors for — in each mode. */
export function secretFormFields(mode: SecretFormMode): SecretFormField[] {
  if (mode === "create") return ["key", "value", "allowedDomains", "description"];
  if (mode === "replace") return ["value"];
  return ["allowedDomains", "description"];
}

/** The value is write-only: it is never prefilled, not even when editing. */
export function secretFormDefaults(secret?: Secret): SecretFormValues {
  return {
    allowedDomains: secret?.allowedDomains ?? [],
    description: secret?.description ?? "",
    key: secret?.key ?? "",
    value: "",
  };
}

export function createSecretInput(values: SecretFormValues): CreateSecretInput {
  return {
    allowedDomains: values.allowedDomains,
    ...(values.description.trim() ? { description: values.description.trim() } : {}),
    key: values.key,
    value: values.value,
  };
}

export function replaceValueInput(values: SecretFormValues): ReplaceSecretInput {
  return { value: values.value };
}

export function replaceMetaInput(values: SecretFormValues): ReplaceSecretInput {
  return {
    allowedDomains: values.allowedDomains,
    description: values.description.trim() || null,
  };
}

export function secretFormTitle(mode: SecretFormMode, secret?: Pick<Secret, "key">): string {
  if (mode === "create") return "Add secret";
  const key = secret?.key ?? "SECRET";
  return mode === "replace" ? `Replace {{${key}}}` : `Edit {{${key}}}`;
}

export function secretFormSubmitLabel(mode: SecretFormMode): string {
  if (mode === "create") return "Add secret";
  return mode === "replace" ? "Replace value" : "Save changes";
}

export function secretSavedMessage(mode: SecretFormMode): string {
  if (mode === "create") return "Secret created";
  return mode === "replace" ? "Secret value replaced" : "Secret updated";
}

export function deleteSecretTitle(secret: Pick<Secret, "key">): string {
  return `Delete {{${secret.key}}}?`;
}

export interface SecretFieldError {
  field: SecretFormField;
  message: string;
}

/**
 * Maps API validation details onto the fields visible in this mode. Nested
 * paths (allowedDomains.2) land on their root field; the first message per
 * field wins; anything else falls through to the form-level error.
 */
export function secretFieldErrors(
  details: ApiErrorDetail[] | undefined,
  fields: SecretFormField[],
): SecretFieldError[] {
  const errors: SecretFieldError[] = [];
  for (const detail of details ?? []) {
    const [root] = detail.field.split(".");
    const field = fields.find((candidate) => candidate === root);
    if (!field || errors.some((error) => error.field === field)) continue;
    errors.push({ field, message: detail.message });
  }
  return errors;
}
