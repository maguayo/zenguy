import { ErrorState } from "@zenguy/frontend";

const noop = () => undefined;

export const LoadFailure = () => (
  <ErrorState
    message="Couldn’t load monitors. Check your connection and try again."
    onRetry={noop}
  />
);

export const DefaultMessage = () => <ErrorState onRetry={noop} />;

export const CustomRetryLabel = () => (
  <ErrorState
    message="The run log stream was interrupted before the test finished."
    onRetry={noop}
    retryLabel="Reload run"
  />
);
