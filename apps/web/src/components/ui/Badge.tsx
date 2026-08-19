import type { HTMLAttributes } from "react";
import clsx from "clsx";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "ok" | "danger" | "warn" | "info" | "neutral" | "accent";
}

const tones: Record<NonNullable<BadgeProps["tone"]>, string> = {
  ok: "bg-ok-50 text-ok-700",
  danger: "bg-danger-50 text-danger-700",
  warn: "bg-warn-50 text-warn-600",
  info: "bg-info-50 text-info-600",
  neutral: "bg-zinc-100 text-zinc-700",
  accent: "bg-accent-50 text-accent-700",
};

export function Badge({ children, className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
