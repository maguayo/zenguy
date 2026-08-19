import { Hono } from "hono";
import type { WriteAudit } from "../../application/audit/write_audit";
import { CreateBrowserTest } from "../../application/browser_tests/create_browser_test";
import { CreateRun } from "../../application/browser_tests/create_run";
import { DeleteBrowserTest } from "../../application/browser_tests/delete_browser_test";
import { DownloadReport } from "../../application/browser_tests/download_report";
import { GetAttempt } from "../../application/browser_tests/get_attempt";
import { GetBrowserTest } from "../../application/browser_tests/get_browser_test";
import { GetRun } from "../../application/browser_tests/get_run";
import { ImportBrowserTests } from "../../application/browser_tests/import_tests";
import type { IncidentCloserOnDelete } from "../../application/browser_tests/incident_closer";
import { ListBrowserTests } from "../../application/browser_tests/list_browser_tests";
import { ListRuns } from "../../application/browser_tests/list_runs";
import { RunNow } from "../../application/browser_tests/run_now";
import { UpdateBrowserTest } from "../../application/browser_tests/update_browser_test";
import { ValidateDraft } from "../../application/browser_tests/validate_draft";
import type { RunSecretResolver } from "../../application/browser_tests/redact_run_output";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  ArtifactRepo,
  AttemptRepo,
  BrowserTestRepo,
  RunRepo,
  StepRepo,
} from "../../domain/browser_tests/repo";
import { browserTestConfigSchema } from "../../domain/browser_tests/rules";
import { serializeTestsFile } from "../../domain/browser_tests/transfer";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { AttemptMessage } from "../../domain/queues";
import type { DurableWorkflowRepo } from "../../domain/durability/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import type { IdGenerator } from "../../shared/ids";
import type { RateLimiter } from "../../shared/ratelimit";
import type { PublishQueueOutbox } from "../../application/durability/publish_outbox";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireActiveSubscription } from "../middleware/require_subscription";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { presentBrowserTest } from "../presenters/browser_test";
import {
  presentAttempt,
  presentRun,
  presentRunListItem,
} from "../presenters/run";
import { zjson, zquery } from "../validate";

export interface BrowserTestRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  channels: ChannelRepo;
  tests: BrowserTestRepo;
  runs: RunRepo;
  attempts: AttemptRepo;
  steps: StepRepo;
  artifacts: ArtifactRepo;
  artifactStorage: Pick<ArtifactStorage, "get">;
  incidents: IncidentCloserOnDelete;
  durableWorkflows: Pick<DurableWorkflowRepo, "insertRunWithAttempt">;
  outboxPublisher: Pick<PublishQueueOutbox, "publishById">;
  rateLimiter: RateLimiter;
  audit: Pick<WriteAudit, "execute">;
  resolveSecrets: RunSecretResolver;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<
    AppConfig,
    "jwtSecret" | "llmModel" | "artifactUrlSecret"
  >;
}

const updateSchema = browserTestConfigSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" },
);

const exportQuerySchema = z.object({
  format: z.enum(["yaml", "json"]).default("yaml"),
});

const runStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "PASSED",
  "FAILED",
  "TIMEOUT",
  "SYSTEM_ERROR",
]);
const runsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  status: runStatusSchema.optional(),
});

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
  const listRuns = new ListRuns(
    dependencies.tests,
    dependencies.runs,
    dependencies.users,
  );
  const getRun = new GetRun(
    dependencies.runs,
    dependencies.attempts,
    dependencies.users,
    dependencies.config,
    dependencies.clock,
    dependencies.resolveSecrets,
  );
  const getAttempt = new GetAttempt(
    dependencies.attempts,
    dependencies.runs,
    dependencies.steps,
    dependencies.artifacts,
    dependencies.config,
    dependencies.clock,
    dependencies.resolveSecrets,
  );
  const downloadReport = new DownloadReport(
    dependencies.runs,
    dependencies.artifacts,
    dependencies.artifactStorage,
    dependencies.rateLimiter,
    dependencies.config,
    dependencies.clock,
  );
  const createRun = new CreateRun(
    dependencies.tests,
    dependencies.runs,
    dependencies.workspaces,
    dependencies.subscriptions,
    dependencies.durableWorkflows,
    dependencies.outboxPublisher,
    dependencies.config,
    dependencies.clock,
    dependencies.ids,
  );
  const runNow = new RunNow(
    createRun,
    dependencies.subscriptions,
    dependencies.rateLimiter,
    dependencies.audit,
  );
  const validateDraft = new ValidateDraft(
    createRun,
    dependencies.subscriptions,
    dependencies.rateLimiter,
  );
  const importBrowserTests = new ImportBrowserTests(
    createBrowserTest,
    updateBrowserTest,
    dependencies.tests,
    dependencies.channels,
    dependencies.subscriptions,
    dependencies.rateLimiter,
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

  // Registered before the ":testId" routes so the static segments win.
  app.get(
    "/:workspaceId/browser-tests/export",
    auth,
    requireVerifiedEmail,
    workspace,
    zquery(exportQuerySchema),
    async (context) => {
      const workspaceEntity = context.get("workspace");
      const format = context.req.valid("query").format;
      const result = await listBrowserTests.execute({
        workspaceId: workspaceEntity.id,
      });
      const body = serializeTestsFile(
        result.map((test) => ({
          id: test.id,
          name: test.name,
          startUrl: test.startUrl,
          instructions: test.instructions,
          device: test.device,
          intervalHours: test.intervalHours,
          maxRetries: test.maxRetries,
          notifyOnRecovery: test.notifyOnRecovery,
          channelIds: test.channelIds,
        })),
        format,
      );
      const date = new Date(dependencies.clock.now())
        .toISOString()
        .slice(0, 10);
      const filename = `zenguy-tests-${workspaceEntity.slug}-${date}.${format}`;
      return new Response(body, {
        headers: {
          "Content-Type":
            format === "yaml"
              ? "text/yaml; charset=utf-8"
              : "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    },
  );

  app.post(
    "/:workspaceId/browser-tests/import",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("tests.manage"),
    active,
    async (context) => {
      const fileText = await context.req.text();
      const result = await importBrowserTests.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        fileText,
        ip: requestIp(context),
      });
      return context.json({
        data: {
          created: result.created,
          updated: result.updated,
          tests: result.tests.map(presentBrowserTest),
        },
      });
    },
  );

  app.get(
    "/:workspaceId/browser-tests/:testId/runs",
    auth,
    requireVerifiedEmail,
    workspace,
    zquery(runsQuerySchema),
    async (context) => {
      const query = context.req.valid("query");
      const result = await listRuns.execute({
        workspaceId: context.get("workspace").id,
        testId: context.req.param("testId"),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
        ...(query.status === undefined ? {} : { status: query.status }),
      });
      return context.json({
        data: result.runs.map(presentRunListItem),
        nextCursor: result.nextCursor,
      });
    },
  );

  app.get(
    "/:workspaceId/runs/:runId/report",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await downloadReport.execute({
        workspaceId: context.get("workspace").id,
        runId: context.req.param("runId"),
      });
      return new Response(result.markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
        },
      });
    },
  );

  app.get(
    "/:workspaceId/runs/:runId",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await getRun.execute({
        workspaceId: context.get("workspace").id,
        runId: context.req.param("runId"),
      });
      return context.json({ data: presentRun(result) });
    },
  );

  app.get(
    "/:workspaceId/attempts/:attemptId",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await getAttempt.execute({
        workspaceId: context.get("workspace").id,
        attemptId: context.req.param("attemptId"),
      });
      return context.json({ data: presentAttempt(result) });
    },
  );

  app.post(
    "/:workspaceId/browser-tests/validate",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("tests.run"),
    active,
    zjson(browserTestConfigSchema),
    async (context) => {
      const run = await validateDraft.execute({
        workspaceId: context.get("workspace").id,
        config: context.req.valid("json"),
        actor: context.get("user"),
        actorRole: context.get("role"),
      });
      return context.json({ data: { runId: run.id } }, 202);
    },
  );

  app.post(
    "/:workspaceId/browser-tests/:testId/run-now",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("tests.run"),
    active,
    async (context) => {
      const run = await runNow.execute({
        workspaceId: context.get("workspace").id,
        testId: context.req.param("testId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.json({ data: { runId: run.id } }, 202);
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
