import { UsageMeter } from "@zenguy/frontend";

// Usage.includedRuns is the literal plan size 300 in the API types.
const period = {
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-09-01T00:00:00.000Z",
};

const box: React.CSSProperties = { maxWidth: 360 };

export const WithinPlan = () => (
  <div style={box}>
    <UsageMeter
      timezone="Europe/Madrid"
      usage={{
        ...period,
        billableRuns: 118,
        includedRuns: 300,
        overageRuns: 0,
        overageAmountCents: 0,
        projectedTotalCents: 2900,
        remainingRuns: 182,
      }}
    />
  </div>
);

export const NearingLimit = () => (
  <div style={box}>
    <UsageMeter
      timezone="Europe/Madrid"
      usage={{
        ...period,
        billableRuns: 252,
        includedRuns: 300,
        overageRuns: 0,
        overageAmountCents: 0,
        projectedTotalCents: 2900,
        remainingRuns: 48,
      }}
    />
  </div>
);

export const OverPlan = () => (
  <div style={box}>
    <UsageMeter
      timezone="Europe/Madrid"
      usage={{
        ...period,
        billableRuns: 341,
        includedRuns: 300,
        overageRuns: 41,
        overageAmountCents: 615,
        projectedTotalCents: 3515,
        remainingRuns: 0,
      }}
    />
  </div>
);
