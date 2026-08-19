import { CircleAlert } from "lucide-react";
import type { HTMLAttributes } from "react";
import clsx from "clsx";

import { Button } from "./Button";

export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  message?: string;
  onRetry: () => void;
  retryLabel?: string;
}

export function ErrorState({
  className,
  message = "Something went wrong. Please try again.",
  onRetry,
  retryLabel = "Retry",
  ...props
}: ErrorStateProps) {
  return (
    <div
      className={clsx(
        "flex items-start gap-3 rounded-lg border border-danger-600/20 bg-danger-50 p-4 text-danger-700",
        className,
      )}
      role="alert"
      {...props}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium">{message}</p>
        <Button className="mt-3" onClick={onRetry} size="sm" variant="secondary">
          {retryLabel}
        </Button>
      </div>
    </div>
  );
}
