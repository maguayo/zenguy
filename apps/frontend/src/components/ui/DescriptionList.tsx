import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export interface DescriptionItem {
  label: ReactNode;
  value: ReactNode;
}

export interface DescriptionListProps extends HTMLAttributes<HTMLDListElement> {
  items: DescriptionItem[];
}

export function DescriptionList({ className, items, ...props }: DescriptionListProps) {
  return (
    <dl className={clsx("grid gap-x-6 gap-y-4 sm:grid-cols-2", className)} {...props}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {item.label}
          </dt>
          <dd className="mt-1 min-w-0 text-sm text-zinc-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
