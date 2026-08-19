import { forwardRef, type InputHTMLAttributes } from "react";
import clsx from "clsx";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  invalid?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, invalid = false, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={clsx(
          "size-4 rounded border border-zinc-300 bg-white accent-accent-600 disabled:cursor-not-allowed disabled:opacity-50",
          invalid && "border-danger-600",
          className,
        )}
        type="checkbox"
        {...props}
      />
    );
  },
);
