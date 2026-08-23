import { useEffect, useState } from "react";

import { relativeSeconds } from "../lib/format";

/**
 * The age of the oldest section that has actually answered.
 *
 * A query serving `placeholderData` from another range has `data` but has never
 * fetched, so its `dataUpdatedAt` is 0. Counting it would drag the minimum to
 * zero and report the whole panel as "connecting…" on every range switch, while
 * real numbers sit on screen.
 */
export function oldestUpdate(queries: readonly { dataUpdatedAt: number }[]): number {
  const answered = queries.map((query) => query.dataUpdatedAt).filter((at) => at > 0);
  return answered.length === 0 ? 0 : Math.min(...answered);
}

/**
 * How fresh the panel as a whole is: the age of its *oldest* section, counted on
 * its own second so the rest of the dashboard does not re-render every second.
 */
export function Freshness({ stale, updatedAt }: { stale: boolean; updatedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (updatedAt === 0) return <>Production · connecting…</>;
  if (stale) {
    return (
      <>
        {"Production · "}
        <span className="font-medium text-danger-700">
          {`Some sections are stale — oldest data ${relativeSeconds(updatedAt, now)}`}
        </span>
      </>
    );
  }
  return <>{`Production · updated ${relativeSeconds(updatedAt, now)}`}</>;
}
