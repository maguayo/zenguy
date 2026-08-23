import { Hono } from "hono";
import { z } from "zod";
import { AcceptInvitation } from "../../application/invitations/accept_invitation";
import { GetInvitationPublic } from "../../application/invitations/get_invitation_public";
import { InviteMember } from "../../application/invitations/invite_member";
import { ListInvitations } from "../../application/invitations/list_invitations";
import { RevokeInvitation } from "../../application/invitations/revoke_invitation";
import type { WriteAudit } from "../../application/audit/write_audit";
import type { EmailSender } from "../../domain/email/sender";
import type { UserRepo } from "../../domain/users/repo";
import type {
  InvitationRepo,
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import type { IdGenerator } from "../../shared/ids";
import {
  enforceRateLimitScopes,
  normalizeRateLimitAddress,
  type RateLimiter,
} from "../../shared/ratelimit";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireAction, withWorkspace } from "../middleware/workspace";
import {
  presentInvitation,
  presentPublicInvitation,
} from "../presenters/invitation";
import { zjson } from "../validate";

export interface InvitationRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  invitations: InvitationRepo;
  emailSender: EmailSender;
  audit: Pick<WriteAudit, "execute">;
  rateLimiter: RateLimiter;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "appUrl" | "jwtSecret">;
}

const inviteSchema = z.object({
  email: z.email(),
  role: z.enum(["ADMIN", "MEMBER"]),
});
const publicTokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/u),
});

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

async function enforceInvitationRate(
  limiter: RateLimiter,
  workspaceId: string,
  actorId: string,
  destinationEmail: string,
  ip?: string,
): Promise<void> {
  const [addressHash, destinationHash] = await Promise.all([
    sha256Hex(normalizeRateLimitAddress(ip)),
    sha256Hex(destinationEmail.trim().toLowerCase()),
  ]);
  await enforceRateLimitScopes(
    limiter,
    [
      `invitations:workspace:${workspaceId}`,
      `invitations:actor:${actorId}`,
      `invitations:ip:${addressHash}`,
      `invitations:destination:${destinationHash}`,
    ],
    RATE_LIMITS.invitations,
  );
}

export function workspaceInvitationRoutes(
  dependencies: InvitationRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const inviteMember = new InviteMember(dependencies);
  const listInvitations = new ListInvitations(
    dependencies.invitations,
    dependencies.users,
  );
  const revokeInvitation = new RevokeInvitation(
    dependencies.invitations,
    dependencies.clock,
    dependencies.audit,
  );

  app.post(
    "/:workspaceId/invitations",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("members.invite"),
    zjson(inviteSchema),
    async (context) => {
      const workspaceId = context.get("workspace").id;
      const actor = context.get("user");
      const input = context.req.valid("json");
      await enforceInvitationRate(
        dependencies.rateLimiter,
        workspaceId,
        actor.id,
        input.email,
        requestIp(context),
      );
      const result = await inviteMember.execute({
        ...input,
        workspaceId,
        actor,
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.json({ data: presentInvitation(result) }, 201);
    },
  );

  app.get(
    "/:workspaceId/invitations",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("members.invite"),
    async (context) => {
      const result = await listInvitations.execute({
        workspaceId: context.get("workspace").id,
        actorRole: context.get("role"),
      });
      return context.json({ data: result.map(presentInvitation) });
    },
  );

  app.delete(
    "/:workspaceId/invitations/:invitationId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("members.invite"),
    async (context) => {
      await revokeInvitation.execute({
        workspaceId: context.get("workspace").id,
        invitationId: context.req.param("invitationId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.body(null, 204);
    },
  );

  return app;
}

export function publicInvitationRoutes(
  dependencies: InvitationRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const getInvitation = new GetInvitationPublic(
    dependencies.invitations,
    dependencies.workspaces,
    dependencies.users,
    dependencies.clock,
  );
  const acceptInvitation = new AcceptInvitation(
    dependencies.invitations,
    dependencies.members,
    dependencies.audit,
    dependencies.clock,
    dependencies.ids,
  );

  app.post("/preview", zjson(publicTokenSchema), async (context) => {
    const result = await getInvitation.execute({
      tokenPlain: context.req.valid("json").token,
    });
    return context.json({ data: presentPublicInvitation(result) });
  });

  app.post(
    "/accept",
    requireAuth(dependencies),
    requireVerifiedEmail,
    zjson(publicTokenSchema),
    async (context) => {
      const result = await acceptInvitation.execute({
        tokenPlain: context.req.valid("json").token,
        actor: context.get("user"),
        ip: requestIp(context),
      });
      return context.json({ data: result });
    },
  );

  return app;
}
