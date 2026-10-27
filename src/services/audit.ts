import type { PoolClient } from "pg";

export async function writeAudit(
  client: PoolClient,
  values: {
    actorId: string | null;
    eventType: string;
    targetType: string;
    targetId: string;
    requestId: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (actor_id, event_type, target_type, target_id, request_id, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      values.actorId,
      values.eventType,
      values.targetType,
      values.targetId,
      values.requestId,
      values.reason ?? null,
      JSON.stringify(values.metadata ?? {}),
    ],
  );
}

export async function notifyUser(
  client: PoolClient,
  userId: string,
  eventType: string,
  targetType: string,
  targetId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO notifications (user_id, event_type, target_type, target_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, eventType, targetType, targetId, JSON.stringify(payload)],
  );
}
