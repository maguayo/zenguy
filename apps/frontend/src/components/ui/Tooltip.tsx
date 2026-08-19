import { useId, type ReactNode } from "react";
import clsx from "clsx";

export interface TooltipProps {
  children: ReactNode;
  className?: string;
  content: ReactNode;
}

export function Tooltip({ children, className, content }: TooltipProps) {
  const id = useId();
  return (
    <span
      aria-describedby={id}
      className={clsx("group relative inline-flex", className)}
      tabIndex={0}
    >
      {children}
      <span
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-40 mb-2 w-max max-w-64 -translate-x-1/2 rounded bg-zinc-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        id={id}
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}
