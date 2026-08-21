import type { Role } from "@/api/types";
import { Badge } from "@/ui";

const roleTone = { ADMIN: "info", MEMBER: "neutral", OWNER: "accent" } as const;

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={roleTone[role]}>{role.charAt(0) + role.slice(1).toLowerCase()}</Badge>;
}
