import type { ImportTestsSummary } from "@/api/tests";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";

/** Document types offered by the YAML/JSON import picker. */
export const importDocumentTypes = [
  "application/json",
  "application/x-yaml",
  "text/yaml",
  "text/plain",
  "public.data",
];

export function importSummaryMessage(
  summary: Pick<ImportTestsSummary, "created" | "updated">,
): string {
  return `Import complete: ${summary.created} created, ${summary.updated} updated`;
}

export function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.details && error.details.length > 0) {
    const shown = error.details
      .slice(0, 3)
      .map((detail) => `${detail.field}: ${detail.message}`)
      .join("; ");
    const remaining = error.details.length - 3;
    return remaining > 0 ? `${shown} (+${remaining} more)` : shown;
  }
  return apiErrorMessage(error);
}
