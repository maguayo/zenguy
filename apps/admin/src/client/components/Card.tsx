import type { ReactNode } from "react";

export interface CardProps {
  /** Secondary content aligned with the title, e.g. a freshness or count hint. */
  aside?: ReactNode;
  children: ReactNode;
  title?: string;
}

export function Card({ aside, children, title }: CardProps) {
  return (
    <section className="h-full rounded-lg border border-zinc-200 bg-white p-4">
      {title ? (
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {aside ? <p className="text-xs text-zinc-500">{aside}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
