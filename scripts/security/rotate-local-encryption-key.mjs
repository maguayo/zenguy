import { pathToFileURL } from "node:url";

export const RETIRED_LOCAL_ROTATION_MESSAGE = [
  "Plaintext .dev.vars rotation is disabled.",
  "Use the interactive Keychain workflow instead:",
  "  pnpm --filter @zenguy/api secrets:set -- ENCRYPTION_PREVIOUS_KEYS --replace",
  "  pnpm --filter @zenguy/api secrets:set -- ENCRYPTION_KEY --replace",
  "  pnpm --filter @zenguy/api secrets:set -- ENCRYPTION_KEY_ID --replace",
  "Then complete the documented per-workspace v4 rotation before retiring any old key.",
  "This compatibility wrapper never reads or writes .dev.vars or Keychain values.",
].join("\n");

/**
 * Kept as a fail-closed compatibility wrapper so an old bookmark or shell
 * alias cannot silently recreate the deprecated plaintext rotation path.
 */
export function main() {
  process.stderr.write(`${RETIRED_LOCAL_ROTATION_MESSAGE}\n`);
  return 2;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
