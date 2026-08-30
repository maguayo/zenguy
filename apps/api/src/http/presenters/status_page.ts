import type {
  IncidentUpdate,
  StatusPage,
  StatusPageItem,
} from "../../domain/status_pages/types";

function nullableIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function presentStatusPage(page: StatusPage) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    description: page.description,
    accentColor: page.accentColor,
    theme: page.theme,
    publishedAt: nullableIso(page.publishedAt),
    customDomain:
      page.customDomain === null
        ? null
        : {
            hostname: page.customDomain,
            status: page.customDomainStatus ?? "PENDING",
            checkedAt: nullableIso(page.customDomainCheckedAt),
          },
    createdAt: new Date(page.createdAt).toISOString(),
    updatedAt: new Date(page.updatedAt).toISOString(),
  };
}

export function presentStatusPageItem(item: StatusPageItem) {
  return {
    id: item.id,
    resourceType: item.resourceType,
    resourceId: item.browserTestId ?? item.uptimeMonitorId ?? "",
    displayName: item.displayName,
    groupName: item.groupName,
    position: item.position,
  };
}

export function presentIncidentUpdate(update: IncidentUpdate) {
  return {
    id: update.id,
    message: update.message,
    createdBy: update.createdBy,
    createdAt: new Date(update.createdAt).toISOString(),
  };
}
