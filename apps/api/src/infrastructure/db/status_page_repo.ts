import type {
  StatusPageItemRepo,
  StatusPageRepo,
  StatusPageUpdateFields,
} from "../../domain/status_pages/repo";
import type {
  StatusPage,
  StatusPageItem,
  StatusPageResourceType,
  StatusPageTheme,
} from "../../domain/status_pages/types";
import { all, batch, one, run } from "./d1";

interface StatusPageRow {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  description: string | null;
  accent_color: string | null;
  theme: StatusPageTheme;
  published_at: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toStatusPage(row: StatusPageRow): StatusPage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    accentColor: row.accent_color,
    theme: row.theme,
    publishedAt: row.published_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

interface StatusPageItemRow {
  id: string;
  status_page_id: string;
  workspace_id: string;
  resource_type: StatusPageResourceType;
  browser_test_id: string | null;
  uptime_monitor_id: string | null;
  display_name: string;
  group_name: string | null;
  position: number;
  created_at: number;
}

function toItem(row: StatusPageItemRow): StatusPageItem {
  return {
    id: row.id,
    statusPageId: row.status_page_id,
    workspaceId: row.workspace_id,
    resourceType: row.resource_type,
    browserTestId: row.browser_test_id,
    uptimeMonitorId: row.uptime_monitor_id,
    displayName: row.display_name,
    groupName: row.group_name,
    position: row.position,
    createdAt: row.created_at,
  };
}

export class D1StatusPageRepo implements StatusPageRepo {
  constructor(private readonly database: D1Database) {}

  async insert(page: StatusPage): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO status_pages
            (id, workspace_id, slug, title, description, accent_color, theme,
             published_at, created_by, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          page.id,
          page.workspaceId,
          page.slug,
          page.title,
          page.description,
          page.accentColor,
          page.theme,
          page.publishedAt,
          page.createdBy,
          page.createdAt,
          page.updatedAt,
          page.deletedAt,
        ),
    );
  }

  async findById(workspaceId: string, id: string): Promise<StatusPage | null> {
    const row = await one<StatusPageRow>(
      this.database
        .prepare(
          `SELECT * FROM status_pages
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .bind(workspaceId, id),
    );
    return row === null ? null : toStatusPage(row);
  }

  async findBySlug(slug: string): Promise<StatusPage | null> {
    const row = await one<StatusPageRow>(
      this.database
        .prepare(
          "SELECT * FROM status_pages WHERE slug = ? AND deleted_at IS NULL",
        )
        .bind(slug),
    );
    return row === null ? null : toStatusPage(row);
  }

  async list(workspaceId: string): Promise<StatusPage[]> {
    const rows = await all<StatusPageRow>(
      this.database
        .prepare(
          `SELECT * FROM status_pages
           WHERE workspace_id = ? AND deleted_at IS NULL
           ORDER BY created_at ASC, id ASC`,
        )
        .bind(workspaceId),
    );
    return rows.map(toStatusPage);
  }

  async update(
    id: string,
    changes: StatusPageUpdateFields,
    at: number,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (changes.title !== undefined) {
      sets.push("title = ?");
      values.push(changes.title);
    }
    if (changes.description !== undefined) {
      sets.push("description = ?");
      values.push(changes.description);
    }
    if (changes.slug !== undefined) {
      sets.push("slug = ?");
      values.push(changes.slug);
    }
    if (changes.accentColor !== undefined) {
      sets.push("accent_color = ?");
      values.push(changes.accentColor);
    }
    if (changes.theme !== undefined) {
      sets.push("theme = ?");
      values.push(changes.theme);
    }
    sets.push("updated_at = ?");
    values.push(at);
    await run(
      this.database
        .prepare(
          `UPDATE status_pages SET ${sets.join(", ")}
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(...values, id),
    );
  }

  async setPublished(
    id: string,
    publishedAt: number | null,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE status_pages SET published_at = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(publishedAt, at, id),
    );
  }

  async softDelete(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE status_pages SET deleted_at = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(at, at, id),
    );
  }
}

export class D1StatusPageItemRepo implements StatusPageItemRepo {
  constructor(private readonly database: D1Database) {}

  async insert(item: StatusPageItem): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO status_page_items
            (id, status_page_id, workspace_id, resource_type, browser_test_id,
             uptime_monitor_id, display_name, group_name, position, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          item.id,
          item.statusPageId,
          item.workspaceId,
          item.resourceType,
          item.browserTestId,
          item.uptimeMonitorId,
          item.displayName,
          item.groupName,
          item.position,
          item.createdAt,
        ),
    );
  }

  async listForPage(statusPageId: string): Promise<StatusPageItem[]> {
    const rows = await all<StatusPageItemRow>(
      this.database
        .prepare(
          `SELECT * FROM status_page_items
           WHERE status_page_id = ?
           ORDER BY position ASC, created_at ASC, id ASC`,
        )
        .bind(statusPageId),
    );
    return rows.map(toItem);
  }

  async findById(
    statusPageId: string,
    id: string,
  ): Promise<StatusPageItem | null> {
    const row = await one<StatusPageItemRow>(
      this.database
        .prepare(
          "SELECT * FROM status_page_items WHERE status_page_id = ? AND id = ?",
        )
        .bind(statusPageId, id),
    );
    return row === null ? null : toItem(row);
  }

  async update(
    id: string,
    changes: { displayName?: string; groupName?: string | null },
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (changes.displayName !== undefined) {
      sets.push("display_name = ?");
      values.push(changes.displayName);
    }
    if (changes.groupName !== undefined) {
      sets.push("group_name = ?");
      values.push(changes.groupName);
    }
    if (sets.length === 0) return;
    await run(
      this.database
        .prepare(`UPDATE status_page_items SET ${sets.join(", ")} WHERE id = ?`)
        .bind(...values, id),
    );
  }

  async remove(id: string): Promise<void> {
    await run(
      this.database
        .prepare("DELETE FROM status_page_items WHERE id = ?")
        .bind(id),
    );
  }

  async reorder(statusPageId: string, orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    await batch(
      this.database,
      orderedIds.map((id, index) =>
        this.database
          .prepare(
            `UPDATE status_page_items SET position = ?
             WHERE id = ? AND status_page_id = ?`,
          )
          .bind(index, id, statusPageId),
      ),
    );
  }

  async removeForResource(resource: {
    browserTestId?: string;
    uptimeMonitorId?: string;
  }): Promise<void> {
    if (resource.browserTestId !== undefined) {
      await run(
        this.database
          .prepare("DELETE FROM status_page_items WHERE browser_test_id = ?")
          .bind(resource.browserTestId),
      );
    }
    if (resource.uptimeMonitorId !== undefined) {
      await run(
        this.database
          .prepare("DELETE FROM status_page_items WHERE uptime_monitor_id = ?")
          .bind(resource.uptimeMonitorId),
      );
    }
  }
}
