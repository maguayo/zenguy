import type { ReactNode } from "react";

export interface FieldProps {
  children: ReactNode;
  error?: string;
  hint?: ReactNode;
  htmlFor: string;
  label: ReactNode;
  required?: boolean;
}

export function Field({
  children,
  error,
  hint,
  htmlFor,
  label,
  required = false,
}: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-zinc-900" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-danger-600">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-zinc-500">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
