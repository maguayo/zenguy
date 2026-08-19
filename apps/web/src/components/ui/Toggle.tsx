import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

export interface ToggleProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
  checked: boolean;
  invalid?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  {
    checked,
    className,
    disabled,
    invalid = false,
    onCheckedChange,
    onClick,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-checked={checked}
      aria-invalid={invalid || undefined}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent-600 bg-accent-600" : "border-zinc-300 bg-zinc-200",
        invalid && "border-danger-600",
        className,
      )}
      disabled={disabled}
      role="switch"
      type={type}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(!checked);
      }}
      {...props}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "size-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
});
