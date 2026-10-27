import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { withTransaction } from "../../src/db/transaction.js";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  if (!process.env["DATABASE_URL"])
    throw new Error("DATABASE_URL is required for integration tests");
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await closePool();
});

describe("database-backed readiness", () => {
  it("reports ready when PostgreSQL accepts a query", async () => {
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });

  it("prevents mutation of audit history", async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO audit_events (event_type, target_type, target_id, request_id)
         VALUES ('test.event', 'task', '00000000-0000-4000-8000-000000000099', 'integration-test') RETURNING id`,
      );
      await expect(
        client.query(
          "UPDATE audit_events SET reason = 'rewritten' WHERE id = $1",
          [result.rows[0].id],
        ),
      ).rejects.toThrow("audit events are append-only");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("enforces positive task budgets in PostgreSQL", async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users (id, email, display_name, role, password_hash)
         VALUES ('00000000-0000-4000-8000-000000000098', 'budget-test@trusttask.local', 'Budget Test', 'client', '!disabled!')
         ON CONFLICT (id) DO NOTHING`,
      );
      await expect(
        client.query(
          `INSERT INTO tasks (client_id, title, description, budget_minor, currency, deadline)
         VALUES ('00000000-0000-4000-8000-000000000098', 'Invalid budget',
           'This description is sufficiently long to satisfy the required minimum length.', 0, 'USD', now() + interval '1 day')`,
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "tasks_budget_minor_check",
      });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("rolls back all writes when an application transaction fails", async () => {
    const email = `rollback-${crypto.randomUUID()}@trusttask.local`;
    await expect(
      withTransaction(async (client) => {
        await client.query(
          "INSERT INTO users (email, display_name, role, password_hash) VALUES ($1,'Rollback Test','client','!disabled!')",
          [email],
        );
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    const result = await getPool().query("SELECT 1 FROM users WHERE email=$1", [
      email,
    ]);
    expect(result.rowCount).toBe(0);
  });
});
