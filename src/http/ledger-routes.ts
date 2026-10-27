import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { actorFromRequest, requireRole } from "../auth/session.js";
import { withTransaction } from "../db/transaction.js";
import { notifyUser, writeAudit } from "../services/audit.js";
import { badRequest, conflict, notFound } from "./errors.js";

const idSchema = z.object({ id: z.uuid() });

export async function registerLedgerRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/ledger/:id/reverse", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "admin");
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({
        idempotencyKey: z.string().trim().min(8).max(120),
        reason: z.string().trim().min(10).max(2000),
      })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      throw badRequest(
        "A unique idempotency key and correction reason are required",
      );
    return withTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [body.data.idempotencyKey],
      );
      const previous = await client.query(
        "SELECT id, entry_type, reverses_entry_id FROM ledger_entries WHERE idempotency_key=$1",
        [body.data.idempotencyKey],
      );
      if (previous.rows[0]) {
        if (
          previous.rows[0].entry_type === "reversal" &&
          previous.rows[0].reverses_entry_id === id
        )
          return { ...previous.rows[0], status: "reversed" };
        throw conflict(
          "Idempotency key was already used for a different ledger operation",
        );
      }
      const original = await client.query(
        "SELECT id, contributor_id FROM ledger_entries WHERE id=$1 AND entry_type='earning' FOR UPDATE",
        [id],
      );
      if (!original.rows[0]) throw notFound();
      const existing = await client.query(
        "SELECT id FROM ledger_entries WHERE reverses_entry_id=$1",
        [id],
      );
      if (existing.rows[0])
        throw conflict("This earning already has a compensating reversal");
      const inserted = await client.query(
        `INSERT INTO ledger_entries (entry_type, contributor_id, task_id, submission_id, reverses_entry_id, idempotency_key,
          gross_minor, fee_minor, net_minor, currency, status, correlation_id)
         SELECT 'reversal', contributor_id, task_id, submission_id, id, $2, gross_minor, fee_minor, net_minor, currency, 'reversed', $3
         FROM ledger_entries WHERE id=$1 RETURNING id, reverses_entry_id, status, created_at`,
        [id, body.data.idempotencyKey, request.id],
      );
      const reversal = inserted.rows[0]!;
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "ledger.reversed",
        targetType: "ledger_entry",
        targetId: reversal.id,
        requestId: request.id,
        reason: body.data.reason,
        metadata: { originalEntryId: id },
      });
      await notifyUser(
        client,
        original.rows[0].contributor_id,
        "earnings.reversed",
        "ledger_entry",
        reversal.id,
        { reason: body.data.reason },
      );
      return reversal;
    });
  });
}
