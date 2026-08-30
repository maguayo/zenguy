import type {
  CustomDomainStatus,
  IncidentUpdate,
  StatusPage,
  StatusPageItem,
  StatusPageTheme,
} from "./types";

export interface StatusPageUpdateFields {
  title?: string;
  description?: string | null;
  slug?: string;
  accentColor?: string | null;
  theme?: StatusPageTheme;
}

export interface StatusPageRepo {
  insert(page: StatusPage): Promise<void>;
  findById(workspaceId: string, id: string): Promise<StatusPage | null>;
  findBySlug(slug: string): Promise<StatusPage | null>;
  /** Live page owning this custom domain, whatever its verification status. */
  findByCustomDomain(hostname: string): Promise<StatusPage | null>;
  list(workspaceId: string): Promise<StatusPage[]>;
  update(id: string, changes: StatusPageUpdateFields, at: number): Promise<void>;
  setPublished(id: string, publishedAt: number | null, at: number): Promise<void>;
  setCustomDomain(
    id: string,
    domain: {
      customDomain: string;
      customHostnameId: string;
      status: CustomDomainStatus;
      checkedAt: number;
    },
    at: number,
  ): Promise<void>;
  updateCustomDomainStatus(
    id: string,
    status: CustomDomainStatus,
    checkedAt: number,
    at: number,
  ): Promise<void>;
  clearCustomDomain(id: string, at: number): Promise<void>;
  softDelete(id: string, at: number): Promise<void>;
}

export interface StatusPageItemRepo {
  insert(item: StatusPageItem): Promise<void>;
  /** Items of the page ordered by position ascending. */
  listForPage(statusPageId: string): Promise<StatusPageItem[]>;
  findById(statusPageId: string, id: string): Promise<StatusPageItem | null>;
  update(
    id: string,
    changes: { displayName?: string; groupName?: string | null },
  ): Promise<void>;
  remove(id: string): Promise<void>;
  reorder(statusPageId: string, orderedIds: string[]): Promise<void>;
  removeForResource(resource: {
    browserTestId?: string;
    uptimeMonitorId?: string;
  }): Promise<void>;
}

export interface IncidentUpdateRepo {
  insert(update: IncidentUpdate): Promise<void>;
  /** Updates of the incident, newest first. */
  listForIncident(incidentId: string): Promise<IncidentUpdate[]>;
  listForIncidents(
    workspaceId: string,
    incidentIds: string[],
  ): Promise<Map<string, IncidentUpdate[]>>;
  findById(workspaceId: string, id: string): Promise<IncidentUpdate | null>;
  remove(id: string): Promise<void>;
}
