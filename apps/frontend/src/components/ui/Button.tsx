import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

import { Spinner } from "./Spinner";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "danger" | "ghost";
}

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700",
  secondary: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
  danger: "bg-danger-600 text-white hover:bg-danger-700",
  ghost: "text-zinc-600 hover:bg-zinc-100",
};

const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled,
    loading = false,
    size = "md",
    type = "button",
    variant = "secondary",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        sizes[size],
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading ? <Spinner label="Loading" /> : null}
      {children}
    </button>
  );
});
