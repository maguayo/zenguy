import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center",
        className,
      )}
      {...props}
    >
      {icon ? <div className="mb-3 text-zinc-500">{icon}</div> : null}
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-sm text-zinc-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
