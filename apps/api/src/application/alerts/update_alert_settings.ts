import type { WriteAudit } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { AlertRepo, AlertSettingsUpdate } from "../../domain/alerts/repo";
import {
  MAX_DAILY_PAID_ALERT_LIMIT,
  MIN_DAILY_PAID_ALERT_LIMIT,
  type AlertSettings,
} from "../../domain/alerts/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { forbidden, validation } from "../../shared/errors";
import { ensureAlertSettings } from "./settings";

export class UpdateAlertSettings {
  constructor(
    private readonly alerts: AlertRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly topUpAvailable: boolean,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    paidChannelsEnabled?: boolean;
    dailyPaidAlertLimit?: number;
    ip?: string;
  }): Promise<AlertSettings> {
    if (!can(input.actorRole, "paid_alerts.manage")) throw forbidden();
    if (
      input.paidChannelsEnabled === undefined &&
      input.dailyPaidAlertLimit === undefined
    ) {
      throw validation([
        { field: "body", message: "At least one field is required" },
      ]);
    }
    if (
      input.dailyPaidAlertLimit !== undefined &&
      (!Number.isInteger(input.dailyPaidAlertLimit) ||
        input.dailyPaidAlertLimit < MIN_DAILY_PAID_ALERT_LIMIT ||
        input.dailyPaidAlertLimit > MAX_DAILY_PAID_ALERT_LIMIT)
    ) {
      throw validation([
        {
          field: "dailyPaidAlertLimit",
          message: `Must be an integer between ${MIN_DAILY_PAID_ALERT_LIMIT} and ${MAX_DAILY_PAID_ALERT_LIMIT}`,
        },
      ]);
    }

    const now = this.clock.now();
    const current = await ensureAlertSettings(
      this.alerts,
      input.workspaceId,
      now,
    );
    if (
      input.paidChannelsEnabled === true &&
      !current.paidChannelsEnabled &&
      !this.topUpAvailable &&
      (await this.alerts.getBalanceCents(input.workspaceId)) <= 0
    ) {
      throw validation([
        {
          field: "paidChannelsEnabled",
          message:
            "Top-ups are not available yet, so SMS & calls cannot be turned on",
        },
      ]);
    }

    const changes: AlertSettingsUpdate = {};
    if (input.paidChannelsEnabled !== undefined) {
      changes.paidChannelsEnabled = input.paidChannelsEnabled;
    }
    if (input.dailyPaidAlertLimit !== undefined) {
      changes.dailyPaidAlertLimit = input.dailyPaidAlertLimit;
    }
    await this.alerts.updateSettings(input.workspaceId, changes, now);
    const updated: AlertSettings = {
      ...current,
      ...changes,
      updatedAt: now,
    };
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.alertsSettingsUpdated,
      resourceType: "alert_settings",
      resourceId: input.workspaceId,
      metadata: {
        paidChannelsEnabled: updated.paidChannelsEnabled,
        dailyPaidAlertLimit: updated.dailyPaidAlertLimit,
        changedFields: Object.keys(changes),
      },
      ip: input.ip,
    });
    return updated;
  }
}
