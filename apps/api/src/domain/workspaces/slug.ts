import type { WorkspaceRepo } from "./repo";

const MAX_SLUG_LENGTH = 40;
const SUFFIX_LENGTH = 4;

export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/gu, "");
  return slug === "" ? "workspace" : slug;
}

function randomSuffix(random: () => number): string {
  const possibilities = 36 ** SUFFIX_LENGTH;
  return Math.floor(random() * possibilities)
    .toString(36)
    .padStart(SUFFIX_LENGTH, "0")
    .slice(-SUFFIX_LENGTH);
}

export async function uniqueSlug(
  repo: Pick<WorkspaceRepo, "findBySlug">,
  name: string,
  random: () => number = Math.random,
): Promise<string> {
  const base = slugify(name);
  if ((await repo.findBySlug(base)) === null) return base;

  const shortened = base.slice(0, MAX_SLUG_LENGTH - SUFFIX_LENGTH - 1);
  for (;;) {
    const candidate = `${shortened}-${randomSuffix(random)}`;
    if ((await repo.findBySlug(candidate)) === null) return candidate;
  }
}
