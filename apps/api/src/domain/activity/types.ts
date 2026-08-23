import type { ActivityEventType } from "./catalog";

export type ActivitySource = "web" | "app" | "api" | "server";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  userId: string | null;
  workspaceId: string | null;
  source: ActivitySource;
  resourceType: string | null;
  resourceId: string | null;
  propertiesJson: string | null;
  occurredAt: number;
}
