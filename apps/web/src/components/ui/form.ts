import type { FieldErrors, FieldValues, FormState, Path } from "react-hook-form";

function errorAtPath(errors: FieldErrors, name: string): unknown {
  return name.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, errors);
}

export function fieldError<TFields extends FieldValues>(
  formState: Pick<FormState<TFields>, "errors">,
  name: Path<TFields>,
): string | undefined {
  const error = errorAtPath(formState.errors, name);
  if (typeof error !== "object" || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
