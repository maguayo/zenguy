import { Button, EmptyState } from "@zenguy/frontend";

const noop = () => undefined;

const monitorIcon = (
  <svg
    aria-hidden="true"
    fill="none"
    height="28"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 24 24"
    width="28"
  >
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

export const NoMonitors = () => (
  <EmptyState
    action={
      <Button onClick={noop} variant="primary">
        New monitor
      </Button>
    }
    description="Create your first monitor to start tracking uptime and response times for your endpoints."
    icon={monitorIcon}
    title="No monitors yet"
  />
);

export const NoMatchingRuns = () => (
  <EmptyState
    action={
      <Button onClick={noop} variant="ghost">
        Clear filters
      </Button>
    }
    description="No runs match the current status and date filters. Try widening the date range."
    title="No runs match these filters"
  />
);

export const TitleOnly = () => <EmptyState title="No incidents in this period" />;
