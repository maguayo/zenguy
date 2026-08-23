import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionGrantRepo } from "../../domain/billing/repo";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import {
  isComplimentaryIssuer,
  type AppConfig,
} from "../../shared/config";
import { SUBSCRIPTION_GRANT_TTL_DAYS } from "../../shared/constants";
import { randomToken, sha256Hex } from "../../shared/crypto";
import { forbidden, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { WriteAudit } from "../audit/write_audit";

export interface IssuedSubscriptionGrant {
  id: string;
  token: string;
  redeemUrl: string;
  note: string | null;
  expiresAt: number;
  createdAt: number;
}

export class IssueSubscriptionGrant {
  constructor(
    private readonly grants: SubscriptionGrantRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly config: Pick<
      AppConfig,
      "appUrl" | "complimentaryIssuerEmails"
    >,
  ) {}

  async execute(input: {
    actor: User;
    note?: string;
    ip?: string;
  }): Promise<IssuedSubscriptionGrant> {
    if (
      !isComplimentaryIssuer(
        this.config.complimentaryIssuerEmails,
        input.actor.email,
      )
    ) {
      throw forbidden("You cannot issue complimentary subscription links");
    }
    const note = normalizeNote(input.note);
    const now = this.clock.now();
    const token = randomToken();
    const grant = {
      id: this.ids.newId("sgr"),
      tokenHash: await sha256Hex(token),
      issuedByUserId: input.actor.id,
      note,
      expiresAt: now + SUBSCRIPTION_GRANT_TTL_DAYS * 24 * 60 * 60 * 1_000,
      redeemedAt: null,
      redeemedWorkspaceId: null,
      createdAt: now,
    };
    await this.grants.insert(grant);
    await this.audit.execute({
      workspaceId: "ws_platform",
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.billingGrantIssued,
      resourceType: "subscription_grant",
      resourceId: grant.id,
      metadata: { note },
      ip: input.ip,
    });
    return {
      id: grant.id,
      token,
      // The fragment is delivered to the web/iOS client without entering CDN,
      // origin or Referer logs and is immediately replaced client-side.
      redeemUrl: `${this.config.appUrl}/grants/redeem#${encodeURIComponent(token)}`,
      note,
      expiresAt: grant.expiresAt,
      createdAt: grant.createdAt,
    };
  }
}

function normalizeNote(note: string | undefined): string | null {
  if (note === undefined) return null;
  const trimmed = note.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 200) {
    throw validation([
      { field: "note", message: "Note must be 200 characters or fewer" },
    ]);
  }
  return trimmed;
}
