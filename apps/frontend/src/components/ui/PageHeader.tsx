import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}

export function PageHeader({
  actions,
  className,
  description,
  title,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={clsx("flex flex-wrap items-start justify-between gap-4", className)}
      {...props}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
