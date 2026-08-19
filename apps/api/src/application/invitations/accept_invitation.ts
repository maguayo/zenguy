import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type {
  InvitationRepo,
  MemberRepo,
} from "../../domain/workspaces/repo";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { sha256Hex } from "../../shared/crypto";
import { AppError, forbidden } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { WriteAudit } from "../audit/write_audit";

function gone(): AppError {
  return new AppError("GONE", "This invitation is invalid or has expired");
}

export class AcceptInvitation {
  constructor(
    private readonly invitations: InvitationRepo,
    private readonly members: MemberRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    tokenPlain: string;
    actor: User;
    ip?: string;
  }): Promise<{ workspaceId: string }> {
    const tokenHash = await sha256Hex(input.tokenPlain);
    const now = this.clock.now();
    let invitation = await this.invitations.findValidByHash(tokenHash, now);

    if (invitation === null) {
      const consumed = await this.invitations.findByHash(tokenHash);
      if (
        consumed === null ||
        consumed.acceptedAt === null ||
        consumed.email.toLowerCase() !== input.actor.email.toLowerCase() ||
        (await this.members.find(consumed.workspaceId, input.actor.id)) === null
      ) {
        throw gone();
      }
      return { workspaceId: consumed.workspaceId };
    }

    if (invitation.email.toLowerCase() !== input.actor.email.toLowerCase()) {
      throw forbidden("This invitation was sent to a different email address");
    }
    const existing = await this.members.find(
      invitation.workspaceId,
      input.actor.id,
    );
    if (existing === null) {
      await this.members.insert({
        id: this.ids.newId("mem"),
        workspaceId: invitation.workspaceId,
        userId: input.actor.id,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
        joinedAt: now,
      });
    }
    await this.invitations.markAccepted(invitation.id, now);
    await this.audit.execute({
      workspaceId: invitation.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.memberJoined,
      resourceType: "member",
      resourceId: input.actor.id,
      metadata: { role: existing?.role ?? invitation.role },
      ip: input.ip,
    });
    return { workspaceId: invitation.workspaceId };
  }
}
