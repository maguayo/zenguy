import type {
  DeliveryDispatchClaim,
  DeliveryRepo,
  DeliveryUpdate,
} from "../../domain/channels/repo";
import type {
  DeliveryEventType,
  DeliveryStatus,
  IncidentNotificationDelivery,
  NotificationDelivery,
} from "../../domain/channels/types";
import type { Cursor } from "../../shared/pagination";
import { all, one, run } from "./d1";

interface DeliveryRow {
  id: string;
  workspace_id: string;
  incident_id: string | null;
  notification_channel_id: string;
  event_type: DeliveryEventType;
  status: DeliveryStatus;
  provider_message_id: string | null;
  attempt_count: number;
  error_sanitized: string | null;
  sent_at: number | null;
  created_at: number;
  cost_cents: number | null;
  destination_country: string | null;
  dispatch_state: NotificationDelivery["dispatchState"];
  dispatch_token: string | null;
  dispatch_generation: number;
  provider_idempotency_key: string | null;
}

interface IncidentDeliveryRow extends DeliveryRow {
  channel_name: string | null;
  channel_type: IncidentNotificationDelivery["channelType"];
}

function toDelivery(row: DeliveryRow): NotificationDelivery {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    incidentId: row.incident_id,
    notificationChannelId: row.notification_channel_id,
    eventType: row.event_type,
    status: row.status,
    providerMessageId: row.provider_message_id,
    attemptCount: row.attempt_count,
    errorSanitized: row.error_sanitized,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    costCents: row.cost_cents ?? null,
    destinationCountry: row.destination_country ?? null,
    dispatchState: row.dispatch_state ?? "READY",
    providerIdempotencyKey: row.provider_idempotency_key,
    dispatchGeneration: row.dispatch_generation ?? 0,
  };
}

function toIncidentDelivery(
  row: IncidentDeliveryRow,
): IncidentNotificationDelivery {
  return {
    ...toDelivery(row),
    channelName: row.channel_name ?? "Deleted channel",
    channelType: row.channel_type,
  };
}

export class D1DeliveryRepo implements DeliveryRepo {
  constructor(private readonly database: D1Database) {}

  async insert(delivery: NotificationDelivery): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO notification_deliveries
            (id, workspace_id, incident_id, notification_channel_id,
             event_type, status, provider_message_id, attempt_count,
             error_sanitized, sent_at, created_at, provider_idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          delivery.id,
          delivery.workspaceId,
          delivery.incidentId,
          delivery.notificationChannelId,
          delivery.eventType,
          delivery.status,
          delivery.providerMessageId,
          delivery.attemptCount,
          delivery.errorSanitized,
          delivery.sentAt,
          delivery.createdAt,
          delivery.providerIdempotencyKey ?? delivery.id,
        ),
    );
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<NotificationDelivery | null> {
    const row = await one<DeliveryRow>(
      this.database
        .prepare(
          `SELECT * FROM notification_deliveries
           WHERE workspace_id = ? AND id = ?`,
        )
        .bind(workspaceId, id),
    );
    return row === null ? null : toDelivery(row);
  }

  async beginDispatch(
    workspaceId: string,
    id: string,
    dispatchToken: string,
    claimedAt: number,
    staleBefore: number,
  ): Promise<DeliveryDispatchClaim | null> {
    const row = await one<DeliveryRow>(
      this.database
        .prepare(
          `UPDATE notification_deliveries
           SET processing_at = ?,
               dispatch_state = 'DISPATCHING',
               dispatch_token = ?,
               dispatch_generation = dispatch_generation + 1,
               provider_idempotency_key = COALESCE(provider_idempotency_key, id),
               attempt_count = attempt_count + 1
           WHERE workspace_id = ? AND id = ? AND status = 'PENDING'
             AND dispatch_state = 'READY'
             AND (processing_at IS NULL OR processing_at <= ?)
             AND EXISTS (
               SELECT 1 FROM workspaces
               WHERE workspaces.id = notification_deliveries.workspace_id
                 AND workspaces.deleted_at IS NULL
                 AND workspaces.deletion_state = 'ACTIVE'
             )
           RETURNING *`,
        )
        .bind(claimedAt, dispatchToken, workspaceId, id, staleBefore),
    );
    return row === null
      ? null
      : { delivery: toDelivery(row), dispatchToken };
  }

  async finishDispatch(
    id: string,
    dispatchToken: string,
    changes: DeliveryUpdate,
  ): Promise<boolean> {
    const row = await one<{ id: string }>(
      this.database
        .prepare(
          `UPDATE notification_deliveries
           SET status = ?,
               dispatch_state = CASE
                 WHEN ? = 'PENDING' THEN 'READY'
                 ELSE 'CONFIRMED'
               END,
               processing_at = NULL,
               dispatch_token = NULL,
               provider_message_id = CASE WHEN ? = 1 THEN ? ELSE provider_message_id END,
               error_sanitized = CASE WHEN ? = 1 THEN ? ELSE error_sanitized END,
               attempt_count = ?,
               sent_at = CASE WHEN ? = 1 THEN ? ELSE sent_at END,
               cost_cents = CASE WHEN ? = 1 THEN ? ELSE cost_cents END,
               destination_country = CASE WHEN ? = 1 THEN ? ELSE destination_country END
           WHERE id = ? AND status = 'PENDING'
             AND dispatch_state = 'DISPATCHING' AND dispatch_token = ?
           RETURNING id`,
        )
        .bind(
          changes.status,
          changes.status,
          changes.providerMessageId === undefined ? 0 : 1,
          changes.providerMessageId ?? null,
          changes.errorSanitized === undefined ? 0 : 1,
          changes.errorSanitized ?? null,
          changes.attemptCount,
          changes.sentAt === undefined ? 0 : 1,
          changes.sentAt ?? null,
          changes.costCents === undefined ? 0 : 1,
          changes.costCents ?? null,
          changes.destinationCountry === undefined ? 0 : 1,
          changes.destinationCountry ?? null,
          id,
          dispatchToken,
        ),
    );
    return row !== null;
  }

  async markDispatchAmbiguous(
    id: string,
    dispatchToken: string,
    attemptCount: number,
    errorSanitized: string,
  ): Promise<NotificationDelivery | null> {
    const row = await one<DeliveryRow>(
      this.database
        .prepare(
          `UPDATE notification_deliveries
           SET dispatch_state = 'AMBIGUOUS', processing_at = NULL,
               dispatch_token = NULL, attempt_count = ?, error_sanitized = ?
           WHERE id = ? AND status = 'PENDING'
             AND dispatch_state = 'DISPATCHING' AND dispatch_token = ?
           RETURNING *`,
        )
        .bind(attemptCount, errorSanitized, id, dispatchToken),
    );
    return row === null ? null : toDelivery(row);
  }

  async markStaleDispatchAmbiguous(
    workspaceId: string,
    id: string,
    staleBefore: number,
    errorSanitized: string,
  ): Promise<NotificationDelivery | null> {
    const row = await one<DeliveryRow>(
      this.database
        .prepare(
          `UPDATE notification_deliveries
           SET dispatch_state = 'AMBIGUOUS', processing_at = NULL,
               dispatch_token = NULL, error_sanitized = ?
           WHERE workspace_id = ? AND id = ? AND status = 'PENDING'
             AND dispatch_state = 'DISPATCHING' AND processing_at <= ?
           RETURNING *`,
        )
        .bind(errorSanitized, workspaceId, id, staleBefore),
    );
    return row === null ? null : toDelivery(row);
  }

  async recordProviderAcceptance(
    id: string,
    providerIdempotencyKey: string,
    providerMessageId: string | null,
    sentAt: number,
  ): Promise<boolean> {
    const row = await one<{ id: string }>(
      this.database
        .prepare(
          `UPDATE notification_deliveries
           SET status = 'SENT', dispatch_state = 'CONFIRMED',
               processing_at = NULL, dispatch_token = NULL,
               provider_message_id = ?, error_sanitized = NULL, sent_at = ?
           WHERE id = ? AND status = 'PENDING'
             AND dispatch_state = 'AMBIGUOUS'
             AND provider_idempotency_key = ?
           RETURNING id`,
        )
        .bind(providerMessageId, sentAt, id, providerIdempotencyKey),
    );
    return row !== null;
  }

  async update(id: string, changes: DeliveryUpdate): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE notification_deliveries
           SET status = ?,
               dispatch_state = CASE
                 WHEN ? = 'PENDING' THEN 'READY'
                 ELSE 'CONFIRMED'
               END,
               processing_at = NULL,
               dispatch_token = NULL,
               provider_message_id = CASE WHEN ? = 1 THEN ? ELSE provider_message_id END,
               error_sanitized = CASE WHEN ? = 1 THEN ? ELSE error_sanitized END,
               attempt_count = ?,
               sent_at = CASE WHEN ? = 1 THEN ? ELSE sent_at END,
               cost_cents = CASE WHEN ? = 1 THEN ? ELSE cost_cents END,
               destination_country = CASE WHEN ? = 1 THEN ? ELSE destination_country END
           WHERE id = ?`,
        )
        .bind(
          changes.status,
          changes.status,
          changes.providerMessageId === undefined ? 0 : 1,
          changes.providerMessageId ?? null,
          changes.errorSanitized === undefined ? 0 : 1,
          changes.errorSanitized ?? null,
          changes.attemptCount,
          changes.sentAt === undefined ? 0 : 1,
          changes.sentAt ?? null,
          changes.costCents === undefined ? 0 : 1,
          changes.costCents ?? null,
          changes.destinationCountry === undefined ? 0 : 1,
          changes.destinationCountry ?? null,
          id,
        ),
    );
  }

  async listForChannel(
    channelId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<NotificationDelivery[]> {
    const statement =
      cursor === null || cursor === undefined
        ? this.database
            .prepare(
              `SELECT * FROM notification_deliveries
               WHERE notification_channel_id = ?
               ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .bind(channelId, limit)
        : this.database
            .prepare(
              `SELECT * FROM notification_deliveries
               WHERE notification_channel_id = ?
                 AND (created_at < ? OR (created_at = ? AND id < ?))
               ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .bind(
              channelId,
              cursor.createdAt,
              cursor.createdAt,
              cursor.id,
              limit,
            );
    return (await all<DeliveryRow>(statement)).map(toDelivery);
  }

  async listForIncident(incidentId: string): Promise<NotificationDelivery[]> {
    const rows = await all<DeliveryRow>(
      this.database
        .prepare(
          `SELECT * FROM notification_deliveries
           WHERE incident_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .bind(incidentId),
    );
    return rows.map(toDelivery);
  }

  async listForIncidentWithChannel(
    incidentId: string,
  ): Promise<IncidentNotificationDelivery[]> {
    const rows = await all<IncidentDeliveryRow>(
      this.database
        .prepare(
          `SELECT d.*, c.name AS channel_name, c.type AS channel_type
           FROM notification_deliveries d
           LEFT JOIN notification_channels c
             ON c.id = d.notification_channel_id
            AND c.workspace_id = d.workspace_id
           WHERE d.incident_id = ?
           ORDER BY d.created_at ASC, d.id ASC`,
        )
        .bind(incidentId),
    );
    return rows.map(toIncidentDelivery);
  }
}
