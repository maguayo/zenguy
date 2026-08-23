import type {
  EmailTokenRepo,
  SessionSecurityRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Clock } from "../../shared/clock";
import { hashPassword, sha256Hex } from "../../shared/crypto";
import { AppError, validation } from "../../shared/errors";
import { logEvent } from "../../shared/log";
import { newPasswordIssues } from "../../shared/password_policy";
import type { WriteAudit } from "../audit/write_audit";

export interface ResetPasswordDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
  sessionSecurity: SessionSecurityRepo;
  workspaces: Pick<WorkspaceRepo, "listForUser">;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
}

export class ResetPassword {
  constructor(
    private readonly dependencies: ResetPasswordDependencies,
    private readonly passwordHasher: (password: string) => Promise<string> =
      hashPassword,
  ) {}

  async execute(input: {
    token: string;
    password: string;
    ip?: string;
  }): Promise<{ reset: true }> {
    const passwordIssues = newPasswordIssues(input.password);
    if (passwordIssues.length > 0) {
      throw validation(
        passwordIssues.map((message) => ({ field: "password", message })),
      );
    }
    const now = this.dependencies.clock.now();
    const tokenHash = await sha256Hex(input.token);

    // Reject random, expired and already-used capabilities before paying the
    // intentionally expensive password-hashing cost. This is only a cheap
    // preflight: the conditional consume below remains the authority, so two
    // concurrent reset attempts can never both win.
    const candidate = await this.dependencies.emailTokens.findValidByHash(
      tokenHash,
      "RESET_PASSWORD",
      now,
    );
    if (candidate === null) {
      throw new AppError(
        "GONE",
        "This password reset link is invalid or has expired",
      );
    }

    const passwordHash = await this.passwordHasher(input.password);
    const token = await this.dependencies.emailTokens.consumeValidByHash(
      tokenHash,
      "RESET_PASSWORD",
      now,
    );
    if (token === null) {
      throw new AppError(
        "GONE",
        "This password reset link is invalid or has expired",
      );
    }

    await this.dependencies.sessionSecurity.resetPasswordAndRevokeAll(
      token.userId,
      passwordHash,
      now,
    );
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
