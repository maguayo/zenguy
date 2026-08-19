import { forwardRef, type InputHTMLAttributes } from "react";
import clsx from "clsx";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(
        "h-9 w-full rounded-md border bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500",
        invalid ? "border-danger-600" : "border-zinc-300",
        className,
      )}
      {...props}
    />
  );
});
