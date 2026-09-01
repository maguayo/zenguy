import type { AccountDeletionRepo } from "../../domain/users/account_deletion";
import type { User } from "../../domain/users/types";
import type { MemberRepo, WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import { verifyPassword } from "../../shared/crypto";
import { AppError, validation } from "../../shared/errors";
import type { WorkspaceDeletionCoordinator } from "../workspaces/delete_workspace";

export class DeleteAccount {
  constructor(
    private readonly workspaces: WorkspaceRepo,
    private readonly members: MemberRepo,
    private readonly workspaceDeletion: WorkspaceDeletionCoordinator,
    private readonly accountDeletion: AccountDeletionRepo,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    actor: User;
    password: string;
    confirmation: string;
  }): Promise<void> {
    if (input.confirmation !== "DELETE") {
      throw validation([{ field: "confirmation", message: "Type DELETE to confirm" }]);
    }
    if (!(await verifyPassword(input.password, input.actor.passwordHash))) {
      // This is step-up confirmation inside an already-authenticated session,
      // not a rejected bearer token; keep it distinct from HTTP 401 so clients
      // do not interpret a typo as an expired session.
      throw new AppError("FORBIDDEN", "Password is incorrect");
    }

    const memberships = await this.workspaces.listForUser(input.actor.id);
    const owned = memberships.filter(
      ({ workspace }) => workspace.ownerUserId === input.actor.id,
    );
    const joined = memberships.filter(
      ({ workspace }) => workspace.ownerUserId !== input.actor.id,
    );

    // Tombstoning every owned workspace first makes it inaccessible before any
    // account credential is revoked. The saga then cancels billing and purges
    // workspace objects/data with its existing retry guarantees.
    for (const { workspace } of owned) {
      await this.workspaceDeletion.request(workspace.id);
    }
    for (const { workspace } of joined) {
      await this.members.remove(workspace.id, input.actor.id, this.clock.now());
    }

    await this.accountDeletion.finalize({
      userId: input.actor.id,
      email: input.actor.email,
      at: this.clock.now(),
    });
  }
}
