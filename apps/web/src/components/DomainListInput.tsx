import { useId, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { IconButton } from "./ui/IconButton";
import { Input } from "./ui/Input";

const hostnamePattern =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/u;

export function isAllowedDomain(value: string): boolean {
  const hostname = value.startsWith("*.") ? value.slice(2) : value;
  return hostnamePattern.test(hostname);
}

export function addDomains(
  current: string[],
  input: string,
  max = 20,
): { domains: string[]; error: string | null } {
  const candidates = input
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (candidates.length === 0) return { domains: current, error: null };
  const invalid = candidates.find((domain) => !isAllowedDomain(domain));
  if (invalid) {
    return {
      domains: current,
      error: `“${invalid}” must be a hostname or wildcard such as *.example.com.`,
    };
  }

  const unique = [...current];
  for (const candidate of candidates) {
    if (!unique.includes(candidate)) unique.push(candidate);
  }
  if (unique.length > max) {
    return { domains: current, error: `You can add up to ${max} allowed domains.` };
  }
  return { domains: unique, error: null };
}

export function DomainListInput({
  id,
  invalid = false,
  max = 20,
  onChange,
  value,
}: {
  id: string;
  invalid?: boolean;
  max?: number;
  onChange: (domains: string[]) => void;
  value: string[];
}) {
  const errorId = useId();
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const commit = () => {
    const result = addDomains(value, draft, max);
    setLocalError(result.error);
    if (!result.error) {
      onChange(result.domains);
      setDraft("");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
        {value.map((domain) => (
          <span
            key={domain}
            className="inline-flex max-w-full items-center gap-1 rounded bg-zinc-100 py-0.5 pl-2 pr-0.5 font-mono text-xs text-zinc-700"
          >
            <span className="truncate">{domain}</span>
            <IconButton
              aria-label={`Remove ${domain}`}
              className="size-6 shrink-0"
              onClick={() => onChange(value.filter((item) => item !== domain))}
            >
              <X aria-hidden="true" className="size-3" />
            </IconButton>
          </span>
        ))}
        <Input
          aria-describedby={localError ? errorId : undefined}
          aria-invalid={invalid || Boolean(localError)}
          className="h-7 min-w-44 flex-1 border-0 px-1 font-mono shadow-none focus:ring-0"
          id={id}
          invalid={invalid || Boolean(localError)}
          placeholder={value.length === 0 ? "example.com" : "Add another domain"}
          value={draft}
          onBlur={() => {
            if (draft.trim()) commit();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setLocalError(null);
          }}
          onKeyDown={onKeyDown}
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
