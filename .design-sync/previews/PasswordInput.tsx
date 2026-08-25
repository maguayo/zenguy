import { Field, PasswordInput } from "@zenguy/frontend";

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 20, maxWidth: 420 };

export const InField = () => (
  <div style={col}>
    <Field
      hint="Used by the runner to sign in during browser tests."
      htmlFor="pw-test-account"
      label="Test account password"
    >
      <PasswordInput defaultValue="hunter2-staging!" id="pw-test-account" />
    </Field>
  </div>
);

export const States = () => (
  <div style={col}>
    <PasswordInput placeholder="Enter your password" />
    <PasswordInput defaultValue="wrong-password" invalid />
    <PasswordInput defaultValue="managed-by-sso" disabled />
  </div>
);
