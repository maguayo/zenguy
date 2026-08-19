import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Clock } from "../../shared/clock";
import { hashPassword, sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import { logEvent } from "../../shared/log";
import type { WriteAudit } from "../audit/write_audit";

export interface ResetPasswordDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
  refreshTokens: RefreshTokenRepo;
  workspaces: Pick<WorkspaceRepo, "listForUser">;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
}

export class ResetPassword {
  constructor(private readonly dependencies: ResetPasswordDependencies) {}

  async execute(input: {
    token: string;
    password: string;
    ip?: string;
  }): Promise<{ reset: true }> {
    const now = this.dependencies.clock.now();
    const token = await this.dependencies.emailTokens.findValidByHash(
      await sha256Hex(input.token),
      "RESET_PASSWORD",
      now,
    );
    if (token === null) {
      throw new AppError(
        "GONE",
        "This password reset link is invalid or has expired",
      );
    }

    await this.dependencies.users.setPassword(
      token.userId,
      await hashPassword(input.password),
      now,
    );
    await this.dependencies.emailTokens.markUsed(token.id, now);
    await this.dependencies.refreshTokens.revokeAllForUser(token.userId, now);
    try {
      const memberships = await this.dependencies.workspaces.listForUser(
        token.userId,
      );
      await Promise.all(
        memberships.map(({ workspace }) =>
          this.dependencies.audit.execute({
            workspaceId: workspace.id,
            actorUserId: token.userId,
            action: AUDIT_ACTIONS.authPasswordReset,
            resourceType: "user",
            resourceId: token.userId,
            ip: input.ip,
          }),
        ),
      );
    } catch {
      // Like WriteAudit itself, workspace discovery for this cross-workspace
      // security event must never make a completed reset look unsuccessful.
      logEvent("audit_write_failed");
    }
    return { reset: true };
  }
}
