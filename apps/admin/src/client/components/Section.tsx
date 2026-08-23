import type { ReactNode } from "react";

import { relativeSeconds } from "../lib/format";
import { Card } from "./Card";

/** The slice of a react-query result a section needs — a plain object in tests. */
export interface SectionQuery<T> {
  data: T | undefined;
  dataUpdatedAt: number;
  error: unknown;
  isError: boolean;
  isPending: boolean;
  refetch: () => void;
}

export interface SectionProps<T> {
  children: (data: T) => ReactNode;
  now: number;
  query: SectionQuery<T>;
  /** What is loading, mid-sentence: "Loading workers…". */
  subject: string;
  title: string;
}

/**
 * Every dashboard section renders through here so a failed *background* refetch
 * cannot pass for live data: the last numbers stay on screen, marked stale with
 * their age. Only a section that has nothing cached falls back to an error.
 */
export function Section<T>({ children, now, query, subject, title }: SectionProps<T>) {
  if (query.data === undefined) {
    return (
      <Card title={title}>
        {query.isPending ? (
          <p className="text-zinc-500">{`Loading ${subject}…`}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-danger-700">
              {query.error instanceof Error ? query.error.message : `Could not load ${subject}`}
            </p>
            <button
              className="h-9 rounded-md border border-zinc-300 bg-white px-3 font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => query.refetch()}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-1">
      {query.isError ? (
        <p className="text-xs font-medium text-danger-700">
          {`Stale — last updated ${relativeSeconds(query.dataUpdatedAt, now)}`}
        </p>
      ) : null}
      {children(query.data)}
    </div>
  );
}
