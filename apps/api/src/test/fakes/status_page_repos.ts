import type {
  IncidentUpdateRepo,
  StatusPageItemRepo,
  StatusPageRepo,
  StatusPageUpdateFields,
} from "../../domain/status_pages/repo";
import type {
  CustomDomainStatus,
  IncidentUpdate,
  StatusPage,
  StatusPageItem,
} from "../../domain/status_pages/types";
import {
  MAX_STATUS_PAGES_PER_WORKSPACE,
  MAX_STATUS_PAGE_ITEMS,
} from "../../shared/constants";

export class FakeStatusPageRepo implements StatusPageRepo {
  pages = new Map<string, StatusPage>();

  async insert(page: StatusPage): Promise<void> {
    const live = [...this.pages.values()].filter(
      (entry) => entry.deletedAt === null,
    );
    if (live.some((entry) => entry.slug === page.slug)) {
      throw new Error("UNIQUE constraint failed: status_pages.slug");
    }
    if (
      live.filter((entry) => entry.workspaceId === page.workspaceId).length >=
      MAX_STATUS_PAGES_PER_WORKSPACE
    ) {
      throw new Error("ZENGUY_COLLECTION_CAP_STATUS_PAGES");
    }
    this.pages.set(page.id, { ...page });
  }

  async findById(workspaceId: string, id: string): Promise<StatusPage | null> {
    const page = this.pages.get(id);
    if (
      page === undefined ||
      page.workspaceId !== workspaceId ||
      page.deletedAt !== null
    ) {
      return null;
    }
    return { ...page };
  }

  async findBySlug(slug: string): Promise<StatusPage | null> {
    const page = [...this.pages.values()].find(
      (entry) => entry.slug === slug && entry.deletedAt === null,
    );
    return page === undefined ? null : { ...page };
  }

  async findByCustomDomain(hostname: string): Promise<StatusPage | null> {
    const page = [...this.pages.values()].find(
      (entry) => entry.customDomain === hostname && entry.deletedAt === null,
    );
    return page === undefined ? null : { ...page };
  }

  async list(workspaceId: string): Promise<StatusPage[]> {
    return [...this.pages.values()]
      .filter(
        (entry) =>
          entry.workspaceId === workspaceId && entry.deletedAt === null,
      )
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((entry) => ({ ...entry }));
  }

  async update(
    id: string,
    changes: StatusPageUpdateFields,
    at: number,
  ): Promise<void> {
    const page = this.pages.get(id);
    if (page === undefined || page.deletedAt !== null) return;
    if (changes.slug !== undefined && changes.slug !== page.slug) {
      const taken = [...this.pages.values()].some(
        (entry) =>
          entry.id !== id &&
          entry.deletedAt === null &&
          entry.slug === changes.slug,
      );
      if (taken) throw new Error("UNIQUE constraint failed: status_pages.slug");
    }
    this.pages.set(id, {
      ...page,
      ...(changes.title === undefined ? {} : { title: changes.title }),
      ...(changes.description === undefined
        ? {}
        : { description: changes.description }),
      ...(changes.slug === undefined ? {} : { slug: changes.slug }),
      ...(changes.accentColor === undefined
        ? {}
        : { accentColor: changes.accentColor }),
      ...(changes.theme === undefined ? {} : { theme: changes.theme }),
      updatedAt: at,
    });
  }

  async setPublished(
    id: string,
    publishedAt: number | null,
    at: number,
  ): Promise<void> {
    const page = this.pages.get(id);
    if (page === undefined || page.deletedAt !== null) return;
    this.pages.set(id, { ...page, publishedAt, updatedAt: at });
  }

  async setCustomDomain(
    id: string,
    domain: {
      customDomain: string;
      customHostnameId: string;
      status: CustomDomainStatus;
      checkedAt: number;
    },
    at: number,
  ): Promise<void> {
    const page = this.pages.get(id);
    if (page === undefined || page.deletedAt !== null) return;
    const taken = [...this.pages.values()].some(
      (entry) =>
        entry.id !== id &&
        entry.deletedAt === null &&
        entry.customDomain === domain.customDomain,
    );
    if (taken) {
      throw new Error("UNIQUE constraint failed: status_pages.custom_domain");
    }
    this.pages.set(id, {
      ...page,
      customDomain: domain.customDomain,
      customHostnameId: domain.customHostnameId,
      customDomainStatus: domain.status,
      customDomainCheckedAt: domain.checkedAt,
      updatedAt: at,
    });
  }

  async updateCustomDomainStatus(
    id: string,
    status: CustomDomainStatus,
    checkedAt: number,
    at: number,
  ): Promise<void> {
    const page = this.pages.get(id);
    if (
      page === undefined ||
      page.deletedAt !== null ||
      page.customDomain === null
    ) {
      return;
    }
    this.pages.set(id, {
      ...page,
      customDomainStatus: status,
      customDomainCheckedAt: checkedAt,
      updatedAt: at,
    });
  }

  async clearCustomDomain(id: string, at: number): Promise<void> {
    const page = this.pages.get(id);
    if (page === undefined || page.deletedAt !== null) return;
    this.pages.set(id, {
      ...page,
      customDomain: null,
      customHostnameId: null,
      customDomainStatus: null,
      customDomainCheckedAt: null,
      updatedAt: at,
    });
  }

  async softDelete(id: string, at: number): Promise<void> {
    const page = this.pages.get(id);
    if (page === undefined || page.deletedAt !== null) return;
    this.pages.set(id, { ...page, deletedAt: at, updatedAt: at });
  }
}

export class FakeStatusPageItemRepo implements StatusPageItemRepo {
  items = new Map<string, StatusPageItem>();

  async insert(item: StatusPageItem): Promise<void> {
    const onPage = [...this.items.values()].filter(
      (entry) => entry.statusPageId === item.statusPageId,
    );
    const duplicate = onPage.some(
      (entry) =>
        (item.browserTestId !== null &&
          entry.browserTestId === item.browserTestId) ||
        (item.uptimeMonitorId !== null &&
          entry.uptimeMonitorId === item.uptimeMonitorId),
    );
    if (duplicate) {
      throw new Error("UNIQUE constraint failed: status_page_items");
    }
    if (onPage.length >= MAX_STATUS_PAGE_ITEMS) {
      throw new Error("ZENGUY_COLLECTION_CAP_STATUS_PAGE_ITEMS");
    }
    this.items.set(item.id, { ...item });
  }

  async listForPage(statusPageId: string): Promise<StatusPageItem[]> {
    return [...this.items.values()]
      .filter((entry) => entry.statusPageId === statusPageId)
      .sort((left, right) => left.position - right.position)
      .map((entry) => ({ ...entry }));
  }

  async findById(
    statusPageId: string,
    id: string,
  ): Promise<StatusPageItem | null> {
    const item = this.items.get(id);
    if (item === undefined || item.statusPageId !== statusPageId) return null;
    return { ...item };
  }

  async update(
    id: string,
    changes: { displayName?: string; groupName?: string | null },
  ): Promise<void> {
    const item = this.items.get(id);
    if (item === undefined) return;
    this.items.set(id, {
      ...item,
      ...(changes.displayName === undefined
        ? {}
        : { displayName: changes.displayName }),
      ...(changes.groupName === undefined
        ? {}
        : { groupName: changes.groupName }),
    });
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }

  async reorder(statusPageId: string, orderedIds: string[]): Promise<void> {
    orderedIds.forEach((id, index) => {
      const item = this.items.get(id);
      if (item === undefined || item.statusPageId !== statusPageId) return;
      this.items.set(id, { ...item, position: index });
    });
  }

  async removeForResource(resource: {
    browserTestId?: string;
    uptimeMonitorId?: string;
  }): Promise<void> {
    for (const [id, item] of [...this.items.entries()]) {
      if (
        (resource.browserTestId !== undefined &&
          item.browserTestId === resource.browserTestId) ||
        (resource.uptimeMonitorId !== undefined &&
          item.uptimeMonitorId === resource.uptimeMonitorId)
      ) {
        this.items.delete(id);
      }
    }
  }
}

export class FakeIncidentUpdateRepo implements IncidentUpdateRepo {
  updates = new Map<string, IncidentUpdate>();

  async insert(update: IncidentUpdate): Promise<void> {
    this.updates.set(update.id, { ...update });
  }

  async listForIncident(incidentId: string): Promise<IncidentUpdate[]> {
    return [...this.updates.values()]
      .filter((entry) => entry.incidentId === incidentId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((entry) => ({ ...entry }));
  }

  async listForIncidents(
    workspaceId: string,
    incidentIds: string[],
  ): Promise<Map<string, IncidentUpdate[]>> {
    const grouped = new Map<string, IncidentUpdate[]>();
    for (const incidentId of incidentIds) {
      const updates = (await this.listForIncident(incidentId)).filter(
        (entry) => entry.workspaceId === workspaceId,
      );
      if (updates.length > 0) grouped.set(incidentId, updates);
    }
    return grouped;
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<IncidentUpdate | null> {
    const update = this.updates.get(id);
    if (update === undefined || update.workspaceId !== workspaceId) return null;
    return { ...update };
  }

  async remove(id: string): Promise<void> {
    this.updates.delete(id);
  }
}
