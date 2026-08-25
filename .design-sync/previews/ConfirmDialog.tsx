import { ConfirmDialog } from "@zenguy/frontend";

const noop = () => undefined;

export const DeleteMonitor = () => (
  <ConfirmDialog
    body={
      <>
        Delete monitor <strong>“Checkout flow”</strong>? Its runs and incident
        history will be removed. This can’t be undone.
      </>
    }
    confirmLabel="Delete monitor"
    onClose={noop}
    onConfirm={noop}
    open
    title="Delete monitor"
    tone="danger"
  />
);

export const TypeToConfirm = () => (
  <ConfirmDialog
    body="Deleting the workspace removes every test, monitor, run and notification channel for acme-prod. Members will lose access immediately."
    confirmLabel="Delete workspace"
    onClose={noop}
    onConfirm={noop}
    open
    requireText="acme-prod"
    title="Delete workspace"
    tone="danger"
  />
);
