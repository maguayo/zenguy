import type { HTMLAttributes } from "react";
import clsx from "clsx";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={clsx("motion-safe:animate-pulse rounded bg-zinc-200", className)}
      {...props}
    />
  );
}

export interface TableSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  columns?: number;
}

export function TableSkeleton({ className, columns = 4, ...props }: TableSkeletonProps) {
  return (
    <div aria-label="Loading table" className={clsx("divide-y divide-zinc-200", className)} role="status" {...props}>
      {Array.from({ length: 5 }, (_, row) => (
        <div key={row} className="grid gap-4 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}
