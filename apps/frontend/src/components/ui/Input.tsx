import { forwardRef, type InputHTMLAttributes } from "react";
import clsx from "clsx";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  controlSize?: "md" | "lg";
  invalid?: boolean;
}

const controlSizes: Record<NonNullable<InputProps["controlSize"]>, string> = {
  md: "h-9 px-3",
  lg: "h-11 px-3.5",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, controlSize = "md", invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(
        "w-full rounded-md border bg-white text-sm text-zinc-900 placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500",
        controlSizes[controlSize],
        invalid ? "border-danger-600" : "border-zinc-300",
        className,
      )}
      {...props}
    />
  );
});
