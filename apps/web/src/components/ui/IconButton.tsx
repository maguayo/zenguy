import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ children, className, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        className={clsx(
          "inline-flex size-8 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        type={type}
        {...props}
      >
        {children}
      </button>
    );
  },
);
