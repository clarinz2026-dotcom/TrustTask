import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { actorFromRequest, requireRole } from "../auth/session.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { writeAudit } from "../services/audit.js";
import { badRequest, conflict, notFound } from "./errors.js";

const taskInput = z
  .object({
    title: z.string().trim().min(5).max(160),
    description: z.string().trim().min(20).max(10000),
    acceptanceCriteria: z
      .array(z.string().trim().min(3).max(500))
      .min(1)
      .max(30),
    budgetMinor: z.string().regex(/^[1-9][0-9]{0,17}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    deadline: z.iso.datetime(),
  })
  .strict();
const paramsSchema = z.object({ id: z.uuid() });

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tasks/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const actor = request.headers.authorization
      ? await actorFromRequest(request)
      : undefined;
    const result = await getPool().query(
      `SELECT id, title, description, acceptance_criteria, budget_minor::text, currency, deadline, status, created_at, updated_at
       FROM tasks WHERE id=$1 AND (status='published' OR client_id=$2)`,
      [id, actor?.id ?? null],
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  });

  app.get("/tasks", async (request) => {
    const query = z
      .object({
        search: z.string().trim().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(request.query);
    const result = await getPool().query(
      `SELECT id, title, description, acceptance_criteria, budget_minor::text, currency, deadline, created_at
       FROM tasks WHERE status = 'published' AND deadline > now()
       AND ($1::text IS NULL OR title ILIKE '%' || $1 || '%' OR description ILIKE '%' || $1 || '%')
       ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [query.search ?? null, query.limit, (query.page - 1) * query.limit],
    );
    return { items: result.rows, page: query.page, limit: query.limit };
  });

  app.post("/tasks", async (request, reply) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "client");
    const input = taskInput.safeParse(request.body);
    if (!input.success) throw badRequest("Task fields are invalid");
    if (new Date(input.data.deadline).getTime() <= Date.now())
      throw badRequest("Task deadline must be in the future");
    const task = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO tasks (client_id, title, description, acceptance_criteria, budget_minor, currency, deadline)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          actor.id,
          input.data.title,
          input.data.description,
          input.data.acceptanceCriteria,
          input.data.budgetMinor,
          input.data.currency,
          input.data.deadline,
        ],
      );
      const created = result.rows[0]!;
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "task.created",
        targetType: "task",
        targetId: created.id,
        requestId: request.id,
      });
      return created;
    });
    return reply.code(201).send(task);
  });

  app.patch("/tasks/:id", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "client");
    const { id } = paramsSchema.parse(request.params);
    const input = taskInput.safeParse(request.body);
    if (!input.success) throw badRequest("Task fields are invalid");
    if (new Date(input.data.deadline).getTime() <= Date.now())
      throw badRequest("Task deadline must be in the future");
    return withTransaction(async (client) => {
      const current = await client.query(
        "SELECT client_id, status FROM tasks WHERE id = $1 FOR UPDATE",
        [id],
      );
      const task = current.rows[0];
      if (!task) throw notFound();
      if (task.client_id !== actor.id) throw notFound();
      if (task.status !== "draft")
        throw conflict("Only draft tasks can be edited");
      const result = await client.query(
        `UPDATE tasks SET title=$2, description=$3, acceptance_criteria=$4, budget_minor=$5, currency=$6, deadline=$7, updated_at=now()
         WHERE id=$1 RETURNING *`,
        [
          id,
          input.data.title,
          input.data.description,
          input.data.acceptanceCriteria,
          input.data.budgetMinor,
          input.data.currency,
          input.data.deadline,
        ],
      );
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "task.updated",
        targetType: "task",
        targetId: id,
        requestId: request.id,
      });
      return result.rows[0];
    });
  });

  app.post("/tasks/:id/publish", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "client");
    const { id } = paramsSchema.parse(request.params);
    return withTransaction(async (client) => {
      const current = await client.query(
        "SELECT client_id, status, deadline, acceptance_criteria FROM tasks WHERE id = $1 FOR UPDATE",
        [id],
      );
      const task = current.rows[0];
      if (!task || task.client_id !== actor.id) throw notFound();
      if (task.status !== "draft")
        throw conflict("Only draft tasks can be published");
      if (
        new Date(task.deadline).getTime() <= Date.now() ||
        task.acceptance_criteria.length === 0
      ) {
        throw conflict(
          "A future deadline and acceptance criteria are required",
        );
      }
      await client.query(
        "UPDATE tasks SET status='published', updated_at=now() WHERE id=$1",
        [id],
      );
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "task.published",
        targetType: "task",
        targetId: id,
        requestId: request.id,
      });
      return { id, status: "published" };
    });
  });

  app.post("/tasks/:id/close", async (request) => {
    const actor = await actorFromRequest(request);
    requireRole(actor, "client");
    const { id } = paramsSchema.parse(request.params);
    return withTransaction(async (client) => {
      const current = await client.query(
        "SELECT client_id, status FROM tasks WHERE id=$1 FOR UPDATE",
        [id],
      );
      const task = current.rows[0];
      if (!task || task.client_id !== actor.id) throw notFound();
      if (task.status !== "published")
        throw conflict("Only published tasks can be closed");
      await client.query(
        "UPDATE tasks SET status='closed', updated_at=now() WHERE id=$1",
        [id],
      );
      await writeAudit(client, {
        actorId: actor.id,
        eventType: "task.closed",
        targetType: "task",
        targetId: id,
        requestId: request.id,
      });
      return { id, status: "closed" };
    });
  });
}
