import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { EmailSender } from "../../domain/email/sender";
import type { UserRepo } from "../../domain/users/repo";
import { can } from "../../domain/workspaces/permissions";
import type {
  InvitationRepo,
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { renderInvitationEmail } from "../../infrastructure/email/templates";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { INVITATION_TTL_DAYS } from "../../shared/constants";
import { randomToken, sha256Hex } from "../../shared/crypto";
import { conflict, forbidden, notFound } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import type { WriteAudit } from "../audit/write_audit";
import { invitationOutput, type InvitationOutput } from "./types";

export interface InviteMemberDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  invitations: InvitationRepo;
  emailSender: EmailSender;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "appUrl">;
}

export class InviteMember {
  constructor(private readonly dependencies: InviteMemberDependencies) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    email: string;
    role: "ADMIN" | "MEMBER";
    ip?: string;
  }): Promise<InvitationOutput> {
    if (!can(input.actorRole, "members.invite")) throw forbidden();
    if (input.role === "ADMIN" && !can(input.actorRole, "admins.manage")) {
      throw forbidden("Only the owner can invite admins");
    }

    const workspace = await this.dependencies.workspaces.findById(
      input.workspaceId,
    );
    if (workspace === null) throw notFound("Workspace");
    const email = input.email.trim().toLowerCase();
    const existingUser = await this.dependencies.users.findByEmail(email);
    if (
      existingUser !== null &&
      (await this.dependencies.members.find(workspace.id, existingUser.id)) !==
        null
    ) {
      throw conflict("Already a member");
    }

    const now = this.dependencies.clock.now();
    const pending = await this.dependencies.invitations.findPendingByEmail(
      workspace.id,
      email,
    );
    if (pending !== null) {
      await this.dependencies.invitations.revoke(pending.id, now);
    }

    const tokenPlain = randomToken();
    const invitation = {
      id: this.dependencies.ids.newId("inv"),
      workspaceId: workspace.id,
      email,
      role: input.role,
      tokenHash: await sha256Hex(tokenPlain),
      invitedBy: input.actor.id,
      expiresAt: now + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1_000,
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
    };
    await this.dependencies.invitations.insert(invitation);

    const message = renderInvitationEmail(
      this.dependencies.config.appUrl,
      tokenPlain,
      workspace.name,
      input.actor.name,
      input.role,
    );
    try {
      await this.dependencies.emailSender.send({ ...message, to: [email] });
    } catch {
      logEvent("email_send_failed", { type: "WORKSPACE_INVITATION" });
    }
    await this.dependencies.audit.execute({
      workspaceId: workspace.id,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.memberInvited,
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { email, role: invitation.role },
      ip: input.ip,
    });
    return invitationOutput(invitation, input.actor.name);
  }
}
