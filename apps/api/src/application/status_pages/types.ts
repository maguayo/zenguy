import type { StatusPageTheme } from "../../domain/status_pages/types";
import type { DayAvailability } from "./availability";

export type PublicItemState = "OPERATIONAL" | "DOWN" | "PENDING";
export type OverallStatus = "OPERATIONAL" | "PARTIAL_OUTAGE" | "MAJOR_OUTAGE";

export interface PublicStatusItem {
  /** The status_page_items id — opaque; internal resource ids never leave. */
  id: string;
  displayName: string;
  groupName: string | null;
  state: PublicItemState;
  /** null while the item has no observable lifetime (PENDING). */
  uptimePercent: number | null;
  /** Oldest day first, ending today (UTC). */
  days: DayAvailability[];
}

export interface PublicIncidentUpdateView {
  message: string;
  createdAt: number;
}

export interface PublicIncidentView {
  displayName: string;
  status: "ONGOING" | "RESOLVED";
  startedAt: number;
  resolvedAt: number | null;
  durationSeconds: number;
  /** Newest first. */
  updates: PublicIncidentUpdateView[];
}

export interface PublicStatusPageView {
  slug: string;
  title: string;
  description: string | null;
  accentColor: string | null;
  theme: StatusPageTheme;
  overall: OverallStatus;
  items: PublicStatusItem[];
  /** Ongoing first, then by startedAt descending. */
  incidents: PublicIncidentView[];
  generatedAt: number;
}
