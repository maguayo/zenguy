import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { validation } from "../../shared/errors";
import { browserTestConfigSchema } from "./rules";

export const TRANSFER_VERSION = 1;
export const MAX_TRANSFER_TESTS = 100;
export const MAX_TRANSFER_BYTES = 2_000_000;

export type TransferFormat = "yaml" | "json";

const transferEntrySchema = browserTestConfigSchema.extend({
  id: z.string().optional(),
});

export type BrowserTestTransferEntry = z.infer<typeof transferEntrySchema>;

const transferFileSchema = z
  .strictObject({
    version: z.literal(TRANSFER_VERSION),
    tests: z.array(transferEntrySchema).min(1).max(MAX_TRANSFER_TESTS),
  })
  .superRefine((file, context) => {
    const seen = new Set<string>();
    file.tests.forEach((test, index) => {
      if (test.id === undefined) return;
      if (seen.has(test.id)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate id in file",
          path: ["tests", index, "id"],
        });
      }
      seen.add(test.id);
    });
  });

export type BrowserTestsTransferFile = z.infer<typeof transferFileSchema>;

function orderedEntry(entry: BrowserTestTransferEntry) {
  return {
    ...(entry.id === undefined ? {} : { id: entry.id }),
    name: entry.name,
    startUrl: entry.startUrl,
    instructions: entry.instructions,
    device: entry.device,
    intervalHours: entry.intervalHours,
    maxRetries: entry.maxRetries,
    notifyOnRecovery: entry.notifyOnRecovery,
    channelIds: [...entry.channelIds],
  };
}

export function serializeTestsFile(
  entries: BrowserTestTransferEntry[],
  format: TransferFormat,
): string {
  const file = { version: TRANSFER_VERSION, tests: entries.map(orderedEntry) };
  return format === "json"
    ? `${JSON.stringify(file, null, 2)}\n`
    : stringifyYaml(file);
}

function fileError(message: string): never {
  throw validation([{ field: "file", message }]);
}

export function parseTestsFile(text: string): BrowserTestsTransferFile {
  if (new TextEncoder().encode(text).length > MAX_TRANSFER_BYTES) {
    fileError("File exceeds the 2 MB limit");
  }
  let document: unknown;
  try {
    // YAML is a superset of JSON, so one parser accepts both formats.
    document = parseYaml(text);
  } catch {
    fileError("File is not valid YAML or JSON");
  }
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    fileError("Expected an object with version and tests");
  }
  const result = transferFileSchema.safeParse(document);
  if (!result.success) {
    throw validation(
      result.error.issues.map((issue) => ({
        field: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
