import { RANGES } from "../lib/range";
import type { RangeDays } from "../lib/range";

/**
 * The one control on the page, and it scopes everything under it: every series,
 * total and leaderboard re-reads against the same window.
 */
export function RangeSwitch({
  onChange,
  value,
}: {
  onChange: (days: RangeDays) => void;
  value: RangeDays;
}) {
  return (
    <div
      aria-label="Series range"
      className="inline-flex rounded-md border border-zinc-300 bg-white p-0.5"
      role="group"
    >
      {RANGES.map((days) => (
        <button
          aria-pressed={days === value}
          className={`rounded-[5px] px-2.5 py-1 font-mono text-xs ${
            days === value
              ? "bg-accent-50 font-medium text-accent-700"
              : "text-zinc-500 hover:text-zinc-900"
          }`}
          key={days}
          onClick={() => onChange(days)}
          type="button"
        >
          {`${days} d`}
        </button>
      ))}
    </div>
  );
}
