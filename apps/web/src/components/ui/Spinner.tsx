import { Loader2 } from "lucide-react";
import clsx from "clsx";

export interface SpinnerProps {
  className?: string;
  label?: string;
  size?: 4 | 5 | 6;
}

const sizeClasses: Record<NonNullable<SpinnerProps["size"]>, string> = {
  4: "size-4",
  5: "size-5",
  6: "size-6",
};

export function Spinner({ className, label = "Loading", size = 4 }: SpinnerProps) {
  return (
    <Loader2
      aria-label={label}
      className={clsx("motion-safe:animate-spin", sizeClasses[size], className)}
      role="status"
    />
  );
}
