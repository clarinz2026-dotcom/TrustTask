import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { actorFromRequest, requireRole } from "../auth/session.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { notifyUser, writeAudit } from "../services/audit.js";
import { badRequest, conflict, notFound } from "./errors.js";

const idSchema = z.object({ id: z.uuid() });

export async function registerSupportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/support/cases", async (request, reply) => {
    const actor = await actorFromRequest(request);
    const body = z
      .object({
        category: z.enum(["task", "payment", "account", "other"]),
        priority: z.enum(["low", "normal", "high"]).default("normal"),
        subject: z.string().trim().min(5).max(180),
        message: z.string().trim().min(1).max(5000),
        taskId: z.uuid().optional(),
      })
      .strict()
      .safeParse(request.body);
    if (!body.success) throw badRequest("Support case fields are invalid");
    const result = await withTransaction(async (client) => {
      if (body.data.taskId) {
        const access = await client.query(
          `SELECT t.client_id, EXISTS (SELECT 1 FROM assignments a WHERE a.task_id=t.id AND a.contributor_id=$2) AS contributor_access
           FROM tasks t WHERE t.id=$1`,
          [body.data.taskId, actor.id],
        );
        const task = access.rows[0];
        if (!task || (task.client_id !== actor.id && !task.contributor_access))
          throw notFound();
      }
      const inserted = await client.query(
        `INSERT INTO support_cases (owner_id, task_id, category, priority, subject)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, status, created_at`,
        [
          actor.id,
          body.data.taskId ?? null,
          body.data.category,
          body.data.priority,
          body.data.subject,
        ],
      );
      const supportCase = inserted.rows[0]!;
      await client.query(
        "INSERT INTO case_messages (case_id, author_id, body) VALUES ($1,$2,$3)",
        [supportCase.id, actor.id, body.data.message],
      );
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "support.case_created",
        targetType: "support_case",
        targetId: supportCase.id,
        requestId: request.id,
      });
      return supportCase;
    });
    return reply.code(201).send(result);
  });

  app.get("/support/cases", async (request) => {
    const actor = await actorFromRequest(request);
    const result = await getPool().query(
      `SELECT c.id, c.owner_id, c.task_id, c.category, c.priority, c.status, c.subject, c.created_at, c.updated_at
       FROM support_cases c WHERE c.owner_id=$1 OR $2 IN ('support','admin') ORDER BY c.updated_at DESC LIMIT 100`,
      [actor.id, actor.role],
    );
    return { items: result.rows };
  });

  app.get("/support/cases/:id/messages", async (request) => {
    const actor = await actorFromRequest(request);
    const { id } = idSchema.parse(request.params);
    await ensureCaseAccess(actor.id, actor.role, id);
    const result = await getPool().query(
      "SELECT id, author_id, body, created_at FROM case_messages WHERE case_id=$1 ORDER BY created_at, id",
      [id],
    );
    return { items: result.rows };
  });

  app.post("/support/cases/:id/messages", async (request, reply) => {
    const actor = await actorFromRequest(request);
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({ body: z.string().trim().min(1).max(5000) })
      .strict()
      .safeParse(request.body);
    if (!body.success) throw badRequest("Message body is invalid");
    const message = await withTransaction(async (client) => {
      const supportCase = await client.query(
        "SELECT owner_id, status FROM support_cases WHERE id=$1 FOR UPDATE",
        [id],
      );
      const row = supportCase.rows[0];
      if (
        !row ||
        (row.owner_id !== actor.id &&
          actor.role !== "support" &&
          actor.role !== "admin")
      )
        throw notFound();
      if (row.status === "resolved")
        throw conflict("Resolved cases cannot receive new messages");
      const inserted = await client.query(
        "INSERT INTO case_messages (case_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, created_at",
        [id, actor.id, body.data.body],
      );
      await client.query(
        "UPDATE support_cases SET updated_at=now() WHERE id=$1",
        [id],
      );
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "support.message_added",
        targetType: "support_case",
        targetId: id,
        requestId: request.id,
      });
      const recipient = actor.id === row.owner_id ? undefined : row.owner_id;
      if (recipient)
        await notifyUser(
          client,
          recipient,
          "support.updated",
          "support_case",
          id,
        );
      return inserted.rows[0];
    });
    return reply.code(201).send(message);
  });

  app.post("/support/cases/:id/resolve", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "support", "admin");
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({ explanation: z.string().trim().min(10).max(4000) })
      .strict()
      .safeParse(request.body);
    if (!body.success) throw badRequest("A resolution explanation is required");
    return withTransaction(async (client) => {
      const result = await client.query(
        "SELECT owner_id, status FROM support_cases WHERE id=$1 FOR UPDATE",
        [id],
      );
      const supportCase = result.rows[0];
      if (!supportCase) throw notFound();
      if (supportCase.status === "resolved")
        throw conflict("Case is already resolved");
      await client.query(
        "UPDATE support_cases SET status='resolved', updated_at=now() WHERE id=$1",
        [id],
      );
      await client.query(
        "INSERT INTO case_messages (case_id, author_id, body) VALUES ($1,$2,$3)",
        [id, actor.id, `Resolution: ${body.data.explanation}`],
      );
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "support.case_resolved",
        targetType: "support_case",
        targetId: id,
        requestId: request.id,
        reason: body.data.explanation,
      });
      await notifyUser(
        client,
        supportCase.owner_id,
        "support.resolved",
        "support_case",
        id,
      );
      return { id, status: "resolved" };
    });
  });

  app.post("/submissions/:id/appeals", async (request, reply) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "contributor");
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({ reason: z.string().trim().min(20).max(4000) })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      throw badRequest("Appeal reason must explain the disputed decision");
    try {
      const appeal = await withTransaction(async (client) => {
        const result = await client.query(
          `SELECT s.status, a.contributor_id FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=$1 FOR UPDATE OF s,a`,
          [id],
        );
        const submission = result.rows[0];
        if (!submission || submission.contributor_id !== actor.id)
          throw notFound();
        if (submission.status !== "rejected")
          throw conflict("Only rejected submissions can be appealed");
        const inserted = await client.query(
          "INSERT INTO appeals (submission_id, appellant_id, reason) VALUES ($1,$2,$3) RETURNING id, status, created_at",
          [id, actor.id, body.data.reason],
        );
        await writeAudit(client, {
          actorId: actor.id,
          eventType: "appeal.opened",
          targetType: "appeal",
          targetId: inserted.rows[0]!.id,
          requestId: request.id,
          reason: body.data.reason,
        });
        return inserted.rows[0];
      });
      return reply.code(201).send(appeal);
    } catch (error) {
      if (isUniqueViolation(error))
        throw conflict("An appeal already exists for this submission");
      throw error;
    }
  });

  app.get("/appeals", async (request) => {
    const actor = await actorFromRequest(request);
    const result =
      actor.role === "support" || actor.role === "admin"
        ? await getPool().query(
            "SELECT * FROM appeals ORDER BY created_at DESC LIMIT 100",
          )
        : await getPool().query(
            "SELECT * FROM appeals WHERE appellant_id=$1 ORDER BY created_at DESC LIMIT 100",
            [actor.id],
          );
    return { items: result.rows };
  });

  app.post("/appeals/:id/resolve", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "support", "admin");
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({
        outcome: z.enum(["upheld", "overturned"]),
        explanation: z.string().trim().min(10).max(4000),
      })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      throw badRequest("Appeal outcome and explanation are required");
    return withTransaction(async (client) => {
      const assignmentLookup = await client.query<{ assignment_id: string }>(
        `SELECT s.assignment_id FROM appeals ap JOIN submissions s ON s.id=ap.submission_id WHERE ap.id=$1`,
        [id],
      );
      if (!assignmentLookup.rows[0]) throw notFound();
      await client.query("SELECT id FROM assignments WHERE id=$1 FOR UPDATE", [
        assignmentLookup.rows[0].assignment_id,
      ]);
      const result = await client.query(
        "SELECT appellant_id, submission_id, status FROM appeals WHERE id=$1 FOR UPDATE",
        [id],
      );
      const appeal = result.rows[0];
      if (!appeal) throw notFound();
      if (appeal.status !== "open")
        throw conflict("Appeal is already resolved");
      await client.query(
        "UPDATE appeals SET status=$2, resolution=$3, resolver_id=$4, resolved_at=now() WHERE id=$1",
        [id, body.data.outcome, body.data.explanation, actor.id],
      );
      if (body.data.outcome === "overturned") {
        await client.query(
          "UPDATE submissions SET status='revision_requested' WHERE id=$1 AND status='rejected'",
          [appeal.submission_id],
        );
        await client.query(
          `UPDATE assignments SET status='active'
           WHERE id=(SELECT assignment_id FROM submissions WHERE id=$1) AND status='rejected'`,
          [appeal.submission_id],
        );
      }
      await writeAudit(client, {
        actorId: actor.id,
        eventType: `appeal.${body.data.outcome}`,
        targetType: "appeal",
        targetId: id,
        requestId: request.id,
        reason: body.data.explanation,
      });
      await notifyUser(
        client,
        appeal.appellant_id,
        "appeal.resolved",
        "appeal",
        id,
        { outcome: body.data.outcome },
      );
      return { id, status: body.data.outcome };
    });
  });

  app.get("/notifications", async (request) => {
    const actor = await actorFromRequest(request);
    const result = await getPool().query(
      "SELECT id,event_type,target_type,target_id,payload,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [actor.id],
    );
    return { items: result.rows };
  });

  app.post("/notifications/:id/read", async (request) => {
    const actor = await actorFromRequest(request);
    const { id } = idSchema.parse(request.params);
    const result = await getPool().query(
      "UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2 RETURNING id,read_at",
      [id, actor.id],
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  });

  app.get("/dashboard", async (request) => {
    const actor = await actorFromRequest(request);
    if (actor.role === "contributor") {
      const result = await getPool().query(
        `SELECT
          (SELECT count(*) FROM tasks WHERE status='published' AND deadline>now()) AS available_tasks,
          (SELECT count(*) FROM assignments WHERE contributor_id=$1 AND status='active') AS active_assignments,
          (SELECT count(*) FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.contributor_id=$1 AND s.status IN ('submitted','in_review')) AS awaiting_review,
          (SELECT count(*) FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.contributor_id=$1 AND s.status='revision_requested') AS revisions,
          (SELECT count(*) FROM support_cases WHERE owner_id=$1 AND status<>'resolved') AS open_cases`,
        [actor.id],
      );
      const earnings = await getPool().query(
        "SELECT status, currency, sum(CASE WHEN entry_type='reversal' THEN -net_minor ELSE net_minor END)::text AS net_minor FROM ledger_entries WHERE contributor_id=$1 GROUP BY status,currency",
        [actor.id],
      );
      return {
        role: actor.role,
        metrics: result.rows[0],
        earnings: earnings.rows,
      };
    }
    if (actor.role === "client") {
      const result = await getPool().query(
        `SELECT
          (SELECT count(*) FROM tasks WHERE client_id=$1 AND status='published') AS published_tasks,
          (SELECT count(*) FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN tasks t ON t.id=a.task_id WHERE t.client_id=$1 AND s.status IN ('submitted','in_review')) AS awaiting_review,
          (SELECT count(*) FROM assignments a JOIN tasks t ON t.id=a.task_id WHERE t.client_id=$1 AND a.status='completed') AS completed_assignments,
          (SELECT coalesce(sum(CASE WHEN l.entry_type='reversal' THEN -l.gross_minor ELSE l.gross_minor END),0)::text FROM ledger_entries l WHERE l.task_id IN (SELECT id FROM tasks WHERE client_id=$1)) AS expenditure_minor`,
        [actor.id],
      );
      return { role: actor.role, metrics: result.rows[0] };
    }
    if (actor.role === "reviewer") {
      const result = await getPool().query(
        "SELECT count(*) FROM submissions WHERE status IN ('submitted','in_review')",
      );
      return {
        role: actor.role,
        metrics: { awaiting_review: result.rows[0]!.count },
      };
    }
    const result = await getPool().query(
      `SELECT
        (SELECT count(*) FROM support_cases WHERE status IN ('open','in_progress')) AS outstanding_cases,
        (SELECT count(*) FROM appeals WHERE status='open') AS open_appeals,
        (SELECT count(*) FROM ledger_entries WHERE status='failed') AS failed_ledger_entries,
        (SELECT count(*) FROM audit_events WHERE created_at>now()-interval '24 hours') AS audit_events_24h`,
    );
    return { role: actor.role, metrics: result.rows[0] };
  });
}

async function ensureCaseAccess(
  userId: string,
  role: string,
  caseId: string,
): Promise<void> {
  const result = await getPool().query(
    "SELECT owner_id FROM support_cases WHERE id=$1",
    [caseId],
  );
  const ownerId = result.rows[0]?.owner_id as string | undefined;
  if (
    !ownerId ||
    (ownerId !== userId && role !== "support" && role !== "admin")
  )
    throw notFound();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
