import { Hono } from "hono";
import type { WriteAudit } from "../../application/audit/write_audit";
import { CreateBrowserTest } from "../../application/browser_tests/create_browser_test";
import { DeleteBrowserTest } from "../../application/browser_tests/delete_browser_test";
import { GetBrowserTest } from "../../application/browser_tests/get_browser_test";
import type { IncidentCloserOnDelete } from "../../application/browser_tests/incident_closer";
import { ListBrowserTests } from "../../application/browser_tests/list_browser_tests";
import { UpdateBrowserTest } from "../../application/browser_tests/update_browser_test";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import { browserTestConfigSchema } from "../../domain/browser_tests/rules";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { IdGenerator } from "../../shared/ids";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireActiveSubscription } from "../middleware/require_subscription";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { presentBrowserTest } from "../presenters/browser_test";
import { zjson } from "../validate";

export interface BrowserTestRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  channels: ChannelRepo;
  tests: BrowserTestRepo;
  runs: RunRepo;
  incidents: IncidentCloserOnDelete;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

const updateSchema = browserTestConfigSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" },
);

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function browserTestRoutes(
  dependencies: BrowserTestRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const active = requireActiveSubscription(dependencies.subscriptions);
  const createBrowserTest = new CreateBrowserTest(
    dependencies.tests,
    dependencies.channels,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
    dependencies.ids,
  );
  const updateBrowserTest = new UpdateBrowserTest(
    dependencies.tests,
    dependencies.runs,
    dependencies.channels,
    dependencies.subscriptions,
    dependencies.users,
    dependencies.audit,
    dependencies.clock,
  );
  const deleteBrowserTest = new DeleteBrowserTest(
    dependencies.tests,
    dependencies.subscriptions,
    dependencies.incidents,
    dependencies.audit,
    dependencies.clock,
  );
  const getBrowserTest = new GetBrowserTest(
    dependencies.tests,
    dependencies.runs,
    dependencies.users,
  );
  const listBrowserTests = new ListBrowserTests(
    dependencies.tests,
    dependencies.runs,
    dependencies.users,
  );

  app.get(
    "/:workspaceId/browser-tests",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await listBrowserTests.execute({
        workspaceId: context.get("workspace").id,
      });
      return context.json({ data: result.map(presentBrowserTest) });
    },
  );

  app.post(
    "/:workspaceId/browser-tests",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("tests.manage"),
    active,
    zjson(browserTestConfigSchema),
    async (context) => {
      const result = await createBrowserTest.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        config: context.req.valid("json"),
        ip: requestIp(context),
      });
      return context.json({ data: presentBrowserTest(result) }, 201);
    },
  );

  app.get(
    "/:workspaceId/browser-tests/:testId",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await getBrowserTest.execute({
        workspaceId: context.get("workspace").id,
        testId: context.req.param("testId"),
      });
      return context.json({ data: presentBrowserTest(result) });
    },
  );

  app.patch(
    "/:workspaceId/browser-tests/:testId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("tests.manage"),
    active,
    zjson(updateSchema),
    async (context) => {
      const result = await updateBrowserTest.execute({
        workspaceId: context.get("workspace").id,
        testId: context.req.param("testId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        changes: context.req.valid("json"),
        ip: requestIp(context),
      });
      return context.json({ data: presentBrowserTest(result) });
    },
  );

  app.delete(
    "/:workspaceId/browser-tests/:testId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("tests.manage"),
    active,
    async (context) => {
      await deleteBrowserTest.execute({
        workspaceId: context.get("workspace").id,
        testId: context.req.param("testId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.body(null, 204);
    },
  );

  return app;
}
