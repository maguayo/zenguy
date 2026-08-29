import { Hono } from "hono";
import { z } from "zod";
import type { WriteAudit } from "../../application/audit/write_audit";
import { AddStatusPageItem } from "../../application/status_pages/add_item";
import { CreateStatusPage } from "../../application/status_pages/create_status_page";
import { DeleteStatusPage } from "../../application/status_pages/delete_status_page";
import type { GetPublicStatusPage } from "../../application/status_pages/get_public_status_page";
import { GetStatusPage } from "../../application/status_pages/get_status_page";
import { ListStatusPages } from "../../application/status_pages/list_status_pages";
import { PublishStatusPage } from "../../application/status_pages/publish_status_page";
import { RemoveStatusPageItem } from "../../application/status_pages/remove_item";
import { ReorderStatusPageItems } from "../../application/status_pages/reorder_items";
import { UpdateStatusPageItem } from "../../application/status_pages/update_item";
import { UpdateStatusPage } from "../../application/status_pages/update_status_page";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { BrowserTestRepo } from "../../domain/browser_tests/repo";
import type {
  StatusPageItemRepo,
  StatusPageRepo,
} from "../../domain/status_pages/repo";
import {
  statusPageConfigSchema,
  statusPageItemConfigSchema,
  statusPageItemUpdateSchema,
  statusPageUpdateSchema,
} from "../../domain/status_pages/rules";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { notFound } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { RateLimiter } from "../../shared/ratelimit";
import { collectionCreateRateLimit } from "../../shared/ratelimit";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireActiveSubscription } from "../middleware/require_subscription";
import { requireAction, withWorkspace } from "../middleware/workspace";
import {
  presentStatusPage,
  presentStatusPageItem,
} from "../presenters/status_page";
import { renderStatusPage } from "../views/status_page_html";
import { zjson } from "../validate";

export interface StatusPageRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  statusPages: StatusPageRepo;
  statusPageItems: StatusPageItemRepo;
  monitors: MonitorRepo;
  tests: BrowserTestRepo;
  getPublicStatusPage: GetPublicStatusPage;
  rateLimiter: RateLimiter;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret" | "appUrl">;
}

const reorderSchema = z.object({
  itemIds: z.array(z.string().min(1).max(80)).max(100),
});

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function statusPageRoutes(
  dependencies: StatusPageRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const active = requireActiveSubscription(
    dependencies.subscriptions,
    dependencies.clock,
  );
  const manage = requireAction("status_pages.manage");
  const createLimit = collectionCreateRateLimit(dependencies.rateLimiter);

  const createStatusPage = new CreateStatusPage(
    dependencies.statusPages,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
    dependencies.ids,
  );
  const updateStatusPage = new UpdateStatusPage(
    dependencies.statusPages,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
  );
  const publishStatusPage = new PublishStatusPage(
    dependencies.statusPages,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
  );
  const deleteStatusPage = new DeleteStatusPage(
    dependencies.statusPages,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
  );
  const listStatusPages = new ListStatusPages(dependencies.statusPages);
  const getStatusPage = new GetStatusPage(
    dependencies.statusPages,
    dependencies.statusPageItems,
  );
  const addItem = new AddStatusPageItem(
    dependencies.statusPages,
    dependencies.statusPageItems,
    dependencies.monitors,
    dependencies.tests,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
    dependencies.ids,
  );
  const updateItem = new UpdateStatusPageItem(
    dependencies.statusPages,
    dependencies.statusPageItems,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
  );
  const removeItem = new RemoveStatusPageItem(
    dependencies.statusPages,
    dependencies.statusPageItems,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
  );
  const reorderItems = new ReorderStatusPageItems(
    dependencies.statusPages,
    dependencies.statusPageItems,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
  );

  app.get(
    "/:workspaceId/status-pages",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const pages = await listStatusPages.execute({
        workspaceId: context.get("workspace").id,
      });
      return context.json({ data: pages.map(presentStatusPage) });
    },
  );

  app.post(
    "/:workspaceId/status-pages",
    auth,
    requireVerifiedEmail,
    workspace,
    manage,
    active,
    createLimit,
    zjson(statusPageConfigSchema),
    async (context) => {
      const page = await createStatusPage.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        config: context.req.valid("json"),
        ip: requestIp(context),
      });
      return context.json({ data: presentStatusPage(page) }, 201);
    },
  );

  app.get(
    "/:workspaceId/status-pages/:pageId/preview",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const view = await dependencies.getPublicStatusPage.byId(
        context.get("workspace").id,
        context.req.param("pageId"),
      );
      if (view === null) throw notFound("Status page");
      const canonicalUrl = `${dependencies.config.appUrl}/status/${view.slug}`;
      return context.html(
        renderStatusPage(view, { canonicalUrl, preview: true }),
      );
    },
  );

  app.get(
    "/:workspaceId/status-pages/:pageId",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const detail = await getStatusPage.execute({
        workspaceId: context.get("workspace").id,
        pageId: context.req.param("pageId"),
      });
      return context.json({
        data: {
          ...presentStatusPage(detail.page),
          items: detail.items.map(presentStatusPageItem),
        },
      });
    },
  );

  app.patch(
    "/:workspaceId/status-pages/:pageId",
    auth,
    requireVerifiedEmail,
    workspace,
    manage,
    active,
    zjson(statusPageUpdateSchema),
    async (context) => {
      const page = await updateStatusPage.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        pageId: context.req.param("pageId"),
        config: context.req.valid("json"),
        ip: requestIp(context),
      });
      return context.json({ data: presentStatusPage(page) });
    },
  );

  app.delete(
    "/:workspaceId/status-pages/:pageId",
    auth,
    requireVerifiedEmail,
    workspace,
    manage,
    active,
    async (context) => {
      await deleteStatusPage.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        pageId: context.req.param("pageId"),
        ip: requestIp(context),
      });
      return context.json({ data: { ok: true } });
    },
  );

  for (const action of ["publish", "unpublish"] as const) {
    app.post(
      `/:workspaceId/status-pages/:pageId/${action}`,
      auth,
      requireVerifiedEmail,
      workspace,
      manage,
      active,
      async (context) => {
        const page = await publishStatusPage.execute({
          workspaceId: context.get("workspace").id,
          actor: context.get("user"),
          actorRole: context.get("role"),
          pageId: context.req.param("pageId"),
          publish: action === "publish",
          ip: requestIp(context),
        });
        return context.json({ data: presentStatusPage(page) });
      },
    );
  }

  app.post(
    "/:workspaceId/status-pages/:pageId/items",
    auth,
    requireVerifiedEmail,
    workspace,
    manage,
    active,
    createLimit,
    zjson(statusPageItemConfigSchema),
    async (context) => {
      const item = await addItem.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        pageId: context.req.param("pageId"),
        config: context.req.valid("json"),
        ip: requestIp(context),
      });
      return context.json({ data: presentStatusPageItem(item) }, 201);
    },
  );

  app.put(
    "/:workspaceId/status-pages/:pageId/items/order",
    auth,
    requireVerifiedEmail,
    workspace,
    manage,
    active,
    zjson(reorderSchema),
    async (context) => {
      await reorderItems.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        pageId: context.req.param("pageId"),
        itemIds: context.req.valid("json").itemIds,
        ip: requestIp(context),
      });
      return context.json({ data: { ok: true } });
    },
  );

  app.patch(
    "/:workspaceId/status-pages/:pageId/items/:itemId",
    auth,
    requireVerifiedEmail,
    workspace,
    manage,
    active,
    zjson(statusPageItemUpdateSchema),
    async (context) => {
      const item = await updateItem.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        pageId: context.req.param("pageId"),
        itemId: context.req.param("itemId"),
        config: context.req.valid("json"),
        ip: requestIp(context),
      });
      return context.json({ data: presentStatusPageItem(item) });
    },
  );

  app.delete(
    "/:workspaceId/status-pages/:pageId/items/:itemId",
    auth,
    requireVerifiedEmail,
    workspace,
    manage,
    active,
    async (context) => {
      await removeItem.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        pageId: context.req.param("pageId"),
        itemId: context.req.param("itemId"),
        ip: requestIp(context),
      });
      return context.json({ data: { ok: true } });
    },
  );

  return app;
}
