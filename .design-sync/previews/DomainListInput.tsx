import { DomainListInput, Field } from "@zenguy/frontend";

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 20, maxWidth: 420 };

export const WithDomains = () => (
  <div style={col}>
    <Field
      hint="Browser tests may only navigate to these hosts."
      htmlFor="domains-allowed"
      label="Allowed domains"
    >
      <DomainListInput
        id="domains-allowed"
        onChange={() => {}}
        value={["app.acme.dev", "*.staging.acme.dev", "checkout.acme.dev"]}
      />
    </Field>
  </div>
);

export const Empty = () => (
  <div style={col}>
    <DomainListInput id="domains-empty" onChange={() => {}} value={[]} />
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <Field
      error="Add at least one allowed domain."
      htmlFor="domains-invalid"
      label="Allowed domains"
      required
    >
      <DomainListInput id="domains-invalid" invalid onChange={() => {}} value={[]} />
    </Field>
  </div>
);
