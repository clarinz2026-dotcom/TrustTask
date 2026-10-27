import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { actorFromRequest, requireRole } from "../auth/session.js";
import { calculateEarnings } from "../domain/money.js";
import {
  decideReview,
  nextSubmissionVersion,
  type ReviewDecision,
  type SubmissionStatus,
} from "../domain/review.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { writeAudit, notifyUser } from "../services/audit.js";
import { badRequest, conflict, notFound } from "./errors.js";

const idSchema = z.object({ id: z.uuid() });

export async function registerSubmissionRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/assignments", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "contributor", "client");
    const result =
      actor.role === "contributor"
        ? await getPool().query(
            `SELECT a.id, a.task_id, a.status, a.created_at, t.title, t.deadline,
            coalesce(json_agg(json_build_object('id',s.id,'version',s.version,'status',s.status,'createdAt',s.created_at) ORDER BY s.version)
              FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS submissions
           FROM assignments a JOIN tasks t ON t.id=a.task_id LEFT JOIN submissions s ON s.assignment_id=a.id
           WHERE a.contributor_id=$1 GROUP BY a.id,t.title,t.deadline ORDER BY a.created_at DESC LIMIT 100`,
            [actor.id],
          )
        : await getPool().query(
            `SELECT a.id, a.task_id, a.status, a.created_at, t.title, t.deadline, u.display_name AS contributor,
            coalesce(json_agg(json_build_object('id',s.id,'version',s.version,'status',s.status,'createdAt',s.created_at) ORDER BY s.version)
              FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS submissions
           FROM assignments a JOIN tasks t ON t.id=a.task_id JOIN users u ON u.id=a.contributor_id
           LEFT JOIN submissions s ON s.assignment_id=a.id WHERE t.client_id=$1
           GROUP BY a.id,t.title,t.deadline,u.display_name ORDER BY a.created_at DESC LIMIT 100`,
            [actor.id],
          );
    return { items: result.rows };
  });

  app.get("/submissions/:id", async (request) => {
    const actor = await actorFromRequest(request);
    const { id } = idSchema.parse(request.params);
    const result = await getPool().query(
      `SELECT s.id, s.assignment_id, s.version, s.evidence, s.status, s.created_at,
        a.contributor_id, t.client_id
       FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN tasks t ON t.id=a.task_id WHERE s.id=$1`,
      [id],
    );
    const submission = result.rows[0];
    if (!submission) throw notFound();
    let allowed =
      (actor.role === "contributor" &&
        submission.contributor_id === actor.id) ||
      (actor.role === "client" && submission.client_id === actor.id);
    if (actor.role === "reviewer") {
      const assignment = await getPool().query(
        "SELECT 1 FROM review_assignments WHERE submission_id=$1 AND reviewer_id=$2 AND conflicted_at IS NULL",
        [id, actor.id],
      );
      allowed = Boolean(assignment.rows[0]);
    }
    if (!allowed) throw notFound();
    const reviews = await getPool().query(
      "SELECT id, reviewer_id, decision, reason, created_at FROM reviews WHERE submission_id=$1 ORDER BY created_at",
      [id],
    );
    return { ...submission, reviews: reviews.rows };
  });

  app.get("/reviews/queue", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "reviewer");
    const result = await getPool().query(
      `SELECT s.id AS submission_id, s.version, s.evidence, s.created_at AS submitted_at,
        t.id AS task_id, t.title, t.acceptance_criteria, a.id AS assignment_id
       FROM review_assignments ra JOIN submissions s ON s.id=ra.submission_id
       JOIN assignments a ON a.id=s.assignment_id JOIN tasks t ON t.id=a.task_id
       WHERE ra.reviewer_id=$1 AND ra.conflicted_at IS NULL AND s.status='in_review'
       ORDER BY s.created_at LIMIT 100`,
      [actor.id],
    );
    return { items: result.rows };
  });

  app.post("/reviews/assign", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "admin");
    const body = z
      .object({ submissionId: z.uuid(), reviewerId: z.uuid() })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      throw badRequest("Submission and reviewer identifiers are required");
    return withTransaction(async (client) => {
      const submission = await client.query(
        "SELECT status FROM submissions WHERE id=$1 FOR UPDATE",
        [body.data.submissionId],
      );
      if (!submission.rows[0]) throw notFound();
      if (
        submission.rows[0].status !== "submitted" &&
        submission.rows[0].status !== "in_review"
      )
        throw conflict("Only submitted work can be assigned for review");
      const reviewer = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role='reviewer'",
        [body.data.reviewerId],
      );
      if (!reviewer.rows[0])
        throw badRequest("The selected account is not a reviewer");
      await client.query(
        `INSERT INTO review_assignments (submission_id, reviewer_id, assigned_by) VALUES ($1,$2,$3)
         ON CONFLICT (submission_id) DO UPDATE SET reviewer_id=EXCLUDED.reviewer_id, assigned_by=EXCLUDED.assigned_by, conflicted_at=NULL, created_at=now()`,
        [body.data.submissionId, body.data.reviewerId, actor.id],
      );
      await client.query(
        "UPDATE submissions SET status='in_review' WHERE id=$1",
        [body.data.submissionId],
      );
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "review.assigned",
        targetType: "submission",
        targetId: body.data.submissionId,
        requestId: request.id,
        metadata: { reviewerId: body.data.reviewerId },
      });
      await notifyUser(
        client,
        body.data.reviewerId,
        "review.assigned",
        "submission",
        body.data.submissionId,
      );
      return {
        submissionId: body.data.submissionId,
        reviewerId: body.data.reviewerId,
      };
    });
  });

  app.post("/reviews/:id/conflict", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "reviewer");
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({ reason: z.string().trim().min(10).max(1000) })
      .strict()
      .safeParse(request.body);
    if (!body.success) throw badRequest("Conflict explanation is required");
    return withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE review_assignments SET conflicted_at=now()
         WHERE submission_id=$1 AND reviewer_id=$2 AND conflicted_at IS NULL
         AND EXISTS (SELECT 1 FROM submissions WHERE id=$1 AND status='in_review') RETURNING submission_id`,
        [id, actor.id],
      );
      if (!result.rows[0]) throw notFound();
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "review.conflict_declared",
        targetType: "submission",
        targetId: id,
        requestId: request.id,
        reason: body.data.reason,
      });
      return { submissionId: id, status: "conflict_declared" };
    });
  });

  app.post("/tasks/:id/claim", async (request, reply) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "contributor");
    const { id: taskId } = idSchema.parse(request.params);
    try {
      const assignment = await withTransaction(async (client) => {
        const taskResult = await client.query(
          "SELECT id, status, deadline FROM tasks WHERE id=$1 FOR UPDATE",
          [taskId],
        );
        const task = taskResult.rows[0];
        if (!task) throw notFound();
        if (
          task.status !== "published" ||
          new Date(task.deadline).getTime() <= Date.now()
        ) {
          throw conflict("Task is not available for assignment");
        }
        const result = await client.query(
          "INSERT INTO assignments (task_id, contributor_id) VALUES ($1, $2) RETURNING id, task_id, status, created_at",
          [taskId, actor.id],
        );
        const created = result.rows[0]!;
        await writeAudit(client, {
          actorId: actor.id,
          eventType: "task.claimed",
          targetType: "assignment",
          targetId: created.id,
          requestId: request.id,
        });
        return created;
      });
      return reply.code(201).send(assignment);
    } catch (error) {
      if (isUniqueViolation(error))
        throw conflict("You already have an assignment for this task");
      throw error;
    }
  });

  app.post("/assignments/:id/submissions", async (request, reply) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "contributor");
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({ evidence: z.string().trim().min(10).max(10000) })
      .strict()
      .safeParse(request.body);
    if (!body.success) throw badRequest("Submission evidence is invalid");
    const submission = await withTransaction(async (client) => {
      const assignmentResult = await client.query(
        `SELECT a.id, a.contributor_id, a.status AS assignment_status, t.id AS task_id, t.client_id
         FROM assignments a JOIN tasks t ON t.id=a.task_id WHERE a.id=$1 FOR UPDATE OF a`,
        [id],
      );
      const assignment = assignmentResult.rows[0];
      if (!assignment || assignment.contributor_id !== actor.id)
        throw notFound();
      if (assignment.assignment_status !== "active")
        throw conflict("Assignment is no longer active");
      const latestResult = await client.query(
        "SELECT version, status FROM submissions WHERE assignment_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE",
        [id],
      );
      const latest = latestResult.rows[0] as
        { version: number; status: SubmissionStatus } | undefined;
      let version: number;
      try {
        version = nextSubmissionVersion(latest?.version ?? 0, latest?.status);
      } catch (error) {
        throw conflict(
          error instanceof Error
            ? error.message
            : "Submission cannot be created",
        );
      }
      const inserted = await client.query(
        "INSERT INTO submissions (assignment_id, version, evidence, status) VALUES ($1, $2, $3, 'submitted') RETURNING id, assignment_id, version, status, created_at",
        [id, version, body.data.evidence],
      );
      const created = inserted.rows[0]!;
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "submission.submitted",
        targetType: "submission",
        targetId: created.id,
        requestId: request.id,
        metadata: { version },
      });
      await notifyUser(
        client,
        assignment.client_id,
        "submission.received",
        "submission",
        created.id,
      );
      return created;
    });
    return reply.code(201).send(submission);
  });

  app.post("/submissions/:id/review", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "reviewer", "client");
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({
        decision: z.enum(["approve", "request_revision", "reject"]),
        reason: z.string().trim().min(10).max(4000),
      })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      throw badRequest("Review decision and explanation are required");
    return withTransaction(async (client) => {
      const assignmentLookup = await client.query<{ assignment_id: string }>(
        "SELECT assignment_id FROM submissions WHERE id=$1",
        [id],
      );
      if (!assignmentLookup.rows[0]) throw notFound();
      await client.query("SELECT id FROM assignments WHERE id=$1 FOR UPDATE", [
        assignmentLookup.rows[0].assignment_id,
      ]);
      const query = await client.query<{
        id: string;
        submission_status: SubmissionStatus;
        version: number;
        assignment_id: string;
        contributor_id: string;
        task_id: string;
        client_id: string;
        budget_minor: string;
        currency: string;
      }>(
        `SELECT s.id, s.status AS submission_status, s.version, a.id AS assignment_id, a.contributor_id,
          t.id AS task_id, t.client_id, t.budget_minor::text, t.currency
         FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN tasks t ON t.id=a.task_id
         WHERE s.id=$1 FOR UPDATE OF s`,
        [id],
      );
      const submission = query.rows[0];
      if (!submission) throw notFound();
      if (actor.role === "client" && submission.client_id !== actor.id)
        throw notFound();
      if (actor.role === "reviewer") {
        const assigned = await client.query(
          "SELECT 1 FROM review_assignments WHERE submission_id=$1 AND reviewer_id=$2 AND conflicted_at IS NULL FOR UPDATE",
          [id, actor.id],
        );
        if (!assigned.rows[0]) throw notFound();
      }
      let status: SubmissionStatus;
      try {
        status = decideReview(
          submission.submission_status,
          body.data.decision as ReviewDecision,
          body.data.reason,
        );
      } catch (error) {
        throw conflict(
          error instanceof Error ? error.message : "Review decision is stale",
        );
      }
      const review = await client.query(
        "INSERT INTO reviews (submission_id, reviewer_id, decision, reason) VALUES ($1, $2, $3, $4) RETURNING id",
        [id, actor.id, body.data.decision, body.data.reason],
      );
      await client.query("UPDATE submissions SET status=$2 WHERE id=$1", [
        id,
        status,
      ]);
      if (status === "approved") {
        const earnings = calculateEarnings(BigInt(submission.budget_minor));
        await client.query(
          `INSERT INTO ledger_entries (contributor_id, task_id, submission_id, gross_minor, fee_minor, net_minor, currency, correlation_id, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            submission.contributor_id,
            submission.task_id,
            id,
            earnings.grossMinor.toString(),
            earnings.feeMinor.toString(),
            earnings.netMinor.toString(),
            submission.currency,
            request.id,
            `approval:${id}`,
          ],
        );
        await client.query(
          "UPDATE assignments SET status='completed' WHERE id=$1",
          [submission.assignment_id],
        );
      } else if (status === "rejected") {
        await client.query(
          "UPDATE assignments SET status='rejected' WHERE id=$1",
          [submission.assignment_id],
        );
      }
      await writeAudit(client, {
        actorId: actor.id,
        eventType: `submission.${status}`,
        targetType: "submission",
        targetId: id,
        requestId: request.id,
        reason: body.data.reason,
        metadata: { version: submission.version, decision: body.data.decision },
      });
      const eventType =
        status === "approved"
          ? "review.approved"
          : status === "revision_requested"
            ? "review.revision_requested"
            : "review.rejected";
      await notifyUser(
        client,
        String(submission.contributor_id),
        eventType,
        "submission",
        id,
        { reason: body.data.reason },
      );
      return {
        reviewId: review.rows[0]!.id,
        submissionId: id,
        status,
        version: submission.version,
      };
    });
  });

  app.get("/earnings", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "contributor");
    const result = await getPool().query(
      `SELECT id, task_id, entry_type, reverses_entry_id, gross_minor::text, fee_minor::text, net_minor::text, currency, status, correlation_id, created_at
       FROM ledger_entries WHERE contributor_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [actor.id],
    );
    return { items: result.rows };
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
