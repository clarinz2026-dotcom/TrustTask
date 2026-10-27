import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LocalPaymentSimulator } from "../adapters/payment.js";
import { actorFromRequest, requireRole } from "../auth/session.js";
import { loadConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { conflict, notFound, badRequest } from "./errors.js";
import { writeAudit } from "../services/audit.js";

const idSchema = z.object({ id: z.uuid() });
const simulator = new LocalPaymentSimulator();

export async function registerPaymentRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/ledger/:id/simulate-payment", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "admin");
    if (loadConfig().NODE_ENV === "production")
      throw conflict("The local payment simulator is disabled in production");
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({
        idempotencyKey: z.string().trim().min(8).max(120),
        outcome: z.enum(["paid", "failed"]),
      })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      throw badRequest("Idempotency key and simulated outcome are required");
    const event = await simulator.simulate(
      body.data.idempotencyKey,
      body.data.outcome,
    );
    return withTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [body.data.idempotencyKey],
      );
      const previous = await client.query(
        "SELECT id, ledger_entry_id, requested_outcome, status, provider_reference, created_at FROM payment_attempts WHERE idempotency_key=$1",
        [body.data.idempotencyKey],
      );
      if (previous.rows[0]) {
        const attempt = previous.rows[0];
        if (
          attempt.ledger_entry_id !== id ||
          attempt.requested_outcome !== body.data.outcome
        ) {
          throw conflict(
            "Idempotency key was already used for a different request",
          );
        }
        return { ...attempt, simulated: true };
      }
      const ledger = await client.query(
        "SELECT id FROM ledger_entries WHERE id=$1 AND entry_type='earning' AND status='approved' FOR UPDATE",
        [id],
      );
      if (!ledger.rows[0]) throw notFound();
      const inserted = await client.query(
        `INSERT INTO payment_attempts (ledger_entry_id, idempotency_key, provider, provider_reference, requested_outcome, status, failure_reason, correlation_id)
         VALUES ($1,$2,'local-simulator',$3,$4,'processing',NULL,$5) RETURNING id`,
        [
          id,
          body.data.idempotencyKey,
          event.providerReference,
          body.data.outcome,
          request.id,
        ],
      );
      const attemptId = inserted.rows[0]!.id as string;
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "payment.processing",
        targetType: "payment_attempt",
        targetId: attemptId,
        requestId: request.id,
        metadata: { provider: "local-simulator", ledgerEntryId: id },
      });
      await client.query(
        "UPDATE payment_attempts SET status=$2, failure_reason=$3 WHERE id=$1",
        [attemptId, event.outcome, event.failureReason ?? null],
      );
      await client.query(
        "INSERT INTO payment_provider_events (payment_attempt_id, provider_event_id, event_type) VALUES ($1,$2,$3)",
        [attemptId, event.eventId, `payment.${event.outcome}`],
      );
      await writeAudit(client, {
        actorId: actor.id,
        eventType: `payment.${event.outcome}`,
        targetType: "payment_attempt",
        targetId: attemptId,
        requestId: request.id,
        ...(event.failureReason ? { reason: event.failureReason } : {}),
        metadata: { simulated: true, provider: "local-simulator" },
      });
      return {
        id: attemptId,
        ledgerEntryId: id,
        status: event.outcome,
        providerReference: event.providerReference,
        simulated: true,
      };
    });
  });

  app.get("/ledger/:id/payment-attempts", async (request) => {
    const actor = await actorFromRequest(request);
    const { id } = idSchema.parse(request.params);
    const result = await getPool().query(
      `SELECT p.id,p.status,p.provider,p.provider_reference,p.failure_reason,p.created_at,l.contributor_id,t.client_id
       FROM payment_attempts p JOIN ledger_entries l ON l.id=p.ledger_entry_id JOIN tasks t ON t.id=l.task_id WHERE p.ledger_entry_id=$1 ORDER BY p.created_at DESC`,
      [id],
    );
    if (!result.rows.length) throw notFound();
    if (
      actor.role !== "admin" &&
      actor.role !== "support" &&
      !result.rows.some(
        (row) => row.contributor_id === actor.id || row.client_id === actor.id,
      )
    )
      throw notFound();
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        provider: row.provider,
        provider_reference: row.provider_reference,
        failure_reason: row.failure_reason,
        created_at: row.created_at,
      })),
    };
  });
}
