import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  actions?: ReactNode;
  padding?: "none" | "sm" | "md";
  title?: ReactNode;
}

const paddingClasses: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
};

export function Card({
  actions,
  children,
  className,
  padding = "md",
  title,
  ...props
}: CardProps) {
  return (
    <section
      className={clsx(
        "rounded-lg border border-zinc-200 bg-white",
        paddingClasses[padding],
        className,
      )}
      {...props}
    >
      {title || actions ? (
        <div className={clsx("flex items-center justify-between gap-3", children && "mb-4")}>
          {title ? <h2 className="text-sm font-semibold text-zinc-900">{title}</h2> : <span />}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
