import { LoadMore } from "@zenguy/frontend";

const noop = () => undefined;

export const Ready = () => (
  <LoadMore nextCursor="run_01J8ZK4T9GQW" onMore={noop} />
);

export const Loading = () => (
  <LoadMore loading nextCursor="run_01J8ZK4T9GQW" onMore={noop} />
);
