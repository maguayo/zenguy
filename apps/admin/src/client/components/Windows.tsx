import type { Windows } from "../../shared/types";
import { formatNumber } from "../lib/format";

export type WindowKey = keyof Windows<unknown>;

/** The three windows every past/upcoming block is reported over. */
export const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "h1", label: "1h" },
  { key: "h3", label: "3h" },
  { key: "h24", label: "24h" },
];

/** What is already scheduled for the next 1h/3h/24h. */
export function UpcomingRow({ upcoming }: { upcoming: Windows<number> }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-zinc-100 pt-3 text-zinc-500">
      {WINDOWS.map((window) => (
        <span key={window.key}>
          {`Next ${window.label} `}
          <span className="font-medium text-zinc-900 tabular-nums">
            {formatNumber(upcoming[window.key])}
          </span>
        </span>
      ))}
    </div>
  );
}
