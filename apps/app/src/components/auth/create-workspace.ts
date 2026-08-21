import { z } from "zod";

import type { Workspace } from "@/api/types";

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required.")
    .max(80, "Workspace name must be 80 characters or fewer."),
  timezone: z.string().min(1, "Choose a timezone."),
});

export type CreateWorkspaceValues = z.infer<typeof createWorkspaceSchema>;

export function defaultWorkspaceName(name: string): string {
  const firstName = name.trim().split(/\s+/u)[0];
  return firstName ? `${firstName}'s Workspace` : "My Workspace";
}

/** The device timezone when the API accepts it, otherwise the first known zone. */
export function defaultTimezone(timezones: string[], local: string): string {
  return timezones.includes(local) ? local : (timezones[0] ?? "UTC");
}

/** The workspace the "Back to …" footer points at: the last one used, else the first. */
export function backWorkspace(
  workspaces: Workspace[] | undefined,
  lastWorkspaceId: string | null,
): Workspace | undefined {
  if (!workspaces) return undefined;
  return workspaces.find((workspace) => workspace.id === lastWorkspaceId) ?? workspaces[0];
}
