import { forwardRef, type SelectHTMLAttributes } from "react";
import clsx from "clsx";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { children, className, invalid = false, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(
        "h-9 w-full rounded-md border bg-white px-3 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500",
        invalid ? "border-danger-600" : "border-zinc-300",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
