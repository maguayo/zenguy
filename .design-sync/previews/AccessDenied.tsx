import { AccessDenied } from "@zenguy/frontend";

export const BillingRestricted = () => (
  <div style={{ width: 640 }}>
    <AccessDenied message="Plan & Usage is only visible to workspace owners and admins. Ask an owner of Aurora Plants to update the subscription." />
  </div>
);

export const SecretsRestricted = () => (
  <div style={{ width: 640 }}>
    <AccessDenied message="You need the Admin role to view workspace secrets. Your current role in Aurora Plants is Member." />
  </div>
);
