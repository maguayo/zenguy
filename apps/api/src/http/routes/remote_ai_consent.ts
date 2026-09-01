import { Hono } from "hono";
import { z } from "zod";
import type { WriteAudit } from "../../application/audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import {
  REMOTE_AI_CONSENT_VERSION,
  REMOTE_AI_PROVIDER,
  type RemoteAiConsentRepo,
} from "../../domain/users/remote_ai_consent";
import type { UserRepo } from "../../domain/users/repo";
import type { MemberRepo, WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { zjson } from "../validate";

export interface RemoteAiConsentRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  consents: RemoteAiConsentRepo;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  config: Pick<AppConfig, "jwtSecret">;
}

const grantSchema = z.object({
  consent: z.literal(true),
  policyVersion: z.literal(REMOTE_AI_CONSENT_VERSION),
});

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

function iso(timestamp: number | null): string | null {
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

export function remoteAiConsentRoutes(
  dependencies: RemoteAiConsentRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const middleware = [
    requireAuth(dependencies),
    requireVerifiedEmail,
    withWorkspace(dependencies),
    requireAction("workspace.settings"),
  ] as const;

  app.get("/:workspaceId/remote-ai-consent", ...middleware, async (context) => {
    const consent = await dependencies.consents.find(context.get("workspace").id);
    const current =
      consent?.provider === REMOTE_AI_PROVIDER &&
      consent.policyVersion === REMOTE_AI_CONSENT_VERSION;
    return context.json({
      data: {
        active: current && consent.revokedAt === null,
        provider: "OpenAI" as const,
        policyVersion: REMOTE_AI_CONSENT_VERSION,
        acceptedAt: current ? iso(consent.acceptedAt) : null,
        revokedAt: current ? iso(consent.revokedAt) : null,
      },
    });
  });

  app.put(
    "/:workspaceId/remote-ai-consent",
    ...middleware,
    zjson(grantSchema),
    async (context) => {
      const workspaceId = context.get("workspace").id;
      const actor = context.get("user");
      const at = dependencies.clock.now();
      await dependencies.consents.grant({
        workspaceId,
        provider: REMOTE_AI_PROVIDER,
        policyVersion: REMOTE_AI_CONSENT_VERSION,
        actorUserId: actor.id,
        at,
      });
      await dependencies.audit.execute({
        workspaceId,
        actorUserId: actor.id,
        action: AUDIT_ACTIONS.remoteAiConsentGranted,
        resourceType: "remote_ai_consent",
        resourceId: workspaceId,
        metadata: {
          provider: REMOTE_AI_PROVIDER,
          policyVersion: REMOTE_AI_CONSENT_VERSION,
        },
        ip: requestIp(context),
      });
      return context.json({
        data: {
          active: true,
          provider: "OpenAI" as const,
          policyVersion: REMOTE_AI_CONSENT_VERSION,
          acceptedAt: iso(at),
          revokedAt: null,
        },
      });
    },
  );

  app.delete(
    "/:workspaceId/remote-ai-consent",
    ...middleware,
    async (context) => {
      const workspaceId = context.get("workspace").id;
      const actor = context.get("user");
      const at = dependencies.clock.now();
      if (
        await dependencies.consents.revoke({
          workspaceId,
          actorUserId: actor.id,
          at,
        })
      ) {
        await dependencies.audit.execute({
          workspaceId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.remoteAiConsentRevoked,
          resourceType: "remote_ai_consent",
          resourceId: workspaceId,
          metadata: {
            provider: REMOTE_AI_PROVIDER,
            policyVersion: REMOTE_AI_CONSENT_VERSION,
          },
          ip: requestIp(context),
        });
      }
      return context.body(null, 204);
    },
  );

  return app;
}
