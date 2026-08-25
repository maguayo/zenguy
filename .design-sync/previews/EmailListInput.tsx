import { EmailListInput, Field } from "@zenguy/frontend";

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 20, maxWidth: 420 };

export const WithEmails = () => (
  <div style={col}>
    <Field
      hint="Every address receives incident and recovery alerts."
      htmlFor="emails-alert"
      label="Alert recipients"
    >
      <EmailListInput
        id="emails-alert"
        onChange={() => {}}
        value={["alerts@acme.dev", "oncall@acme.dev"]}
      />
    </Field>
  </div>
);

export const Empty = () => (
  <div style={col}>
    <EmailListInput id="emails-empty" onChange={() => {}} value={[]} />
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <Field
      error="Add at least one recipient."
      htmlFor="emails-invalid"
      label="Alert recipients"
      required
    >
      <EmailListInput id="emails-invalid" invalid onChange={() => {}} value={[]} />
    </Field>
  </div>
);
