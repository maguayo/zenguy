export const runFilterStatuses = ["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"] as const;
export type RunFilterStatus = (typeof runFilterStatuses)[number];
export type RunFilter = "ALL" | RunFilterStatus;

/** Only API-supported status filters are accepted; anything else means "All". */
export function parseRunFilter(value: string | null | undefined): RunFilter {
  return (runFilterStatuses as readonly string[]).includes(value ?? "")
    ? (value as RunFilter)
    : "ALL";
}

export const runFilterItems: { key: RunFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PASSED", label: "Passed" },
  { key: "FAILED", label: "Failed" },
  { key: "TIMEOUT", label: "Timeout" },
  { key: "SYSTEM_ERROR", label: "System error" },
];
