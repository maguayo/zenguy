import assert from "node:assert/strict";
import test from "node:test";

import { validateExistingAccountOnlyEvidence } from "./existing-account-only-contract.mjs";

const validSources = {
  "app/(auth)/sign-in.tsx":
    '<AuthShell description="Sign in with your existing Zenguy account." />',
  "app/access-unavailable.tsx":
    "<Muted>Accounts and workspaces cannot be created here.</Muted>",
  "app/invitations/accept.tsx":
    "<Muted>Invitations can only be accepted by an existing Zenguy account.</Muted>",
  "src/api/auth.ts": 'apiPost("/api/auth/login", credentials)',
};

test("accepts an existing-account-only source snapshot", () => {
  assert.deepEqual(
    validateExistingAccountOnlyEvidence({
      existingForbiddenPaths: [],
      sources: validSources,
    }),
    [],
  );
});

test("rejects removed routes or modules returning to the mobile client", () => {
  const failures = validateExistingAccountOnlyEvidence({
    existingForbiddenPaths: ["app/(auth)/sign-up.tsx", "src/api/billing.ts"],
    sources: validSources,
  });

  assert.deepEqual(failures, [
    "forbidden acquisition path exists: app/(auth)/sign-up.tsx",
    "forbidden acquisition path exists: src/api/billing.ts",
  ]);
});

test("rejects acquisition copy, navigation, APIs and external purchase URLs", () => {
  const sources = {
    ...validSources,
    "app/home.tsx": [
      '<Button title="Create account" />',
      'router.push("/(auth)/sign-up")',
      'apiPost("/api/auth/register", input)',
      'Linking.openURL("https://zenguy.com/pricing/")',
    ].join("\n"),
  };
  const failures = validateExistingAccountOnlyEvidence({ sources });

  assert.equal(
    failures.includes("positive acquisition or purchase copy exists in app/home.tsx"),
    true,
  );
  assert.equal(
    failures.includes("navigation targets a forbidden acquisition route in app/home.tsx"),
    true,
  );
  assert.equal(failures.includes("acquisition API remains callable from app/home.tsx"), true);
  assert.equal(
    failures.includes("external acquisition or purchase URL exists in app/home.tsx"),
    true,
  );
});

test("requires the three user-facing existing-account promises", () => {
  const failures = validateExistingAccountOnlyEvidence({
    sources: { ...validSources, "app/invitations/accept.tsx": "<View />" },
  });

  assert.deepEqual(failures, [
    "missing existing-account-only copy in app/invitations/accept.tsx: Invitations can only be accepted by an existing Zenguy account.",
  ]);
});
