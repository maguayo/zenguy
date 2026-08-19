import { Hono } from "hono";
import { GetCycleUsage } from "../../application/billing/get_cycle_usage";
import { GetOverview } from "../../application/overview/get_overview";
import type {
  SubscriptionRepo,
  UsageEventRepo,
} from "../../domain/billing/repo";
import type { OverviewRepo } from "../../domain/overview/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { withWorkspace } from "../middleware/workspace";
import { presentOverview } from "../presenters/overview";

export interface OverviewRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  usageEvents: UsageEventRepo;
  overview: OverviewRepo;
  clock: Clock;
  config: Pick<AppConfig, "jwtSecret">;
}

export function overviewRoutes(
  dependencies: OverviewRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const getOverview = new GetOverview(
    new GetCycleUsage(
      dependencies.subscriptions,
      dependencies.usageEvents,
      dependencies.clock,
    ),
    dependencies.overview,
    dependencies.clock,
  );

  app.get(
    "/:workspaceId/overview",
    requireAuth(dependencies),
    requireVerifiedEmail,
    withWorkspace(dependencies),
    async (context) => {
      const result = await getOverview.execute({
        workspaceId: context.get("workspace").id,
      });
      return context.json({ data: presentOverview(result) });
    },
  );

  return app;
}
