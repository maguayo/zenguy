import { useId, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { z } from "zod";

import { Input } from "./ui/Input";
import { IconButton } from "./ui/IconButton";

const emailSchema = z.email();

export interface AddEmailsResult {
  emails: string[];
  error: string | null;
}

export function addEmails(
  current: string[],
  input: string,
  max = 10,
): AddEmailsResult {
  const candidates = input
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (candidates.length === 0) return { emails: current, error: null };

  const invalid = candidates.find((email) => !emailSchema.safeParse(email).success);
  if (invalid) return { emails: current, error: `“${invalid}” is not a valid email address.` };

  const unique = [...current];
  for (const candidate of candidates) {
    if (!unique.some((email) => email.toLowerCase() === candidate)) unique.push(candidate);
  }
  if (unique.length > max) {
    return { emails: current, error: `You can add up to ${max} email addresses.` };
  }
  return { emails: unique, error: null };
}

export function EmailListInput({
  id,
  invalid = false,
  max = 10,
  onChange,
  value,
}: {
  id: string;
  invalid?: boolean;
  max?: number;
  onChange: (emails: string[]) => void;
  value: string[];
}) {
  const errorId = useId();
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const commit = () => {
    const result = addEmails(value, draft, max);
    setLocalError(result.error);
    if (!result.error) {
      onChange(result.emails);
      setDraft("");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1 focus-within:border-accent-600 focus-within:ring-2 focus-within:ring-accent-600/20">
        {value.map((email) => (
          <span
            key={email}
            className="inline-flex max-w-full items-center gap-1 rounded bg-zinc-100 py-0.5 pl-2 pr-0.5 text-xs text-zinc-700"
          >
            <span className="truncate">{email}</span>
            <IconButton
              aria-label={`Remove ${email}`}
              className="size-6 shrink-0"
              onClick={() => onChange(value.filter((item) => item !== email))}
            >
              <X aria-hidden="true" className="size-3" />
            </IconButton>
          </span>
        ))}
        <Input
          aria-describedby={localError ? errorId : undefined}
          aria-invalid={invalid || Boolean(localError)}
          className="h-7 min-w-44 flex-1 border-0 px-1 shadow-none focus:ring-0"
          id={id}
          invalid={invalid || Boolean(localError)}
          placeholder={value.length === 0 ? "alerts@example.com" : "Add another email"}
          type="email"
          value={draft}
          onBlur={() => {
            if (draft.trim()) commit();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setLocalError(null);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {localError ? (
        <p className="mt-1 text-xs text-danger-600" id={errorId} role="alert">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
