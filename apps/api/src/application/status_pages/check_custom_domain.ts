import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { StatusPageRepo } from "../../domain/status_pages/repo";
import { customDomainStatusFromHostname } from "../../domain/status_pages/rules";
import type { CustomDomainStatus } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { CustomHostnameClient } from "../../infrastructure/cloudflare/custom_hostnames";
import type { CnameResolver } from "../../infrastructure/dns/doh";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound, unavailable } from "../../shared/errors";
import { rethrowCustomHostnameFailure } from "./custom_hostname_failure";

export interface CustomDomainCheckResult {
  domain: string;
  status: CustomDomainStatus;
  cnameTarget: string;
  cname: { found: boolean; correct: boolean; value: string | null };
  hostnameStatus: string | null;
  sslStatus: string | null;
  errors: string[];
}

export class CheckCustomDomain {
  constructor(
    private readonly pages: StatusPageRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly customHostnames: CustomHostnameClient | null,
    private readonly cnames: CnameResolver,
    private readonly cnameTarget: string | null,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    pageId: string;
  }): Promise<CustomDomainCheckResult> {
    if (!can(input.actorRole, "status_pages.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const page = await this.pages.findById(input.workspaceId, input.pageId);
    if (page === null) throw notFound("Status page");
    if (page.customDomain === null || page.customHostnameId === null) {
      throw notFound("Custom domain");
    }
    if (this.customHostnames === null || this.cnameTarget === null) {
      throw unavailable("Custom domains are not configured on this deployment");
    }

    const [record, cnameValue] = await Promise.all([
      this.customHostnames
        .get(page.customHostnameId)
        .catch((error: unknown) => rethrowCustomHostnameFailure(error, "get")),
      this.cnames.resolve(page.customDomain),
    ]);
    const status: CustomDomainStatus =
      record === null
        ? "FAILED"
        : customDomainStatusFromHostname(record.status, record.sslStatus);
    const now = this.clock.now();
    await this.pages.updateCustomDomainStatus(page.id, status, now, now);
    return {
      domain: page.customDomain,
      status,
      cnameTarget: this.cnameTarget,
      cname: {
        found: cnameValue !== null,
        correct: cnameValue === this.cnameTarget,
        value: cnameValue,
      },
      hostnameStatus: record?.status ?? null,
      sslStatus: record?.sslStatus ?? null,
      errors:
        record === null
          ? ["The hostname no longer exists at Cloudflare — remove and reconnect it."]
          : record.verificationErrors,
    };
  }
}
