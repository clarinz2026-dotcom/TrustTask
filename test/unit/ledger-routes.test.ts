import { afterAll, beforeAll, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "reviewer",
  results: [] as unknown[][],
  queryIndex: 0,
}));
vi.mock("../../src/auth/session.js", async () => {
  const { forbidden } = await import("../../src/http/errors.js");
  return {
    actorFromRequest: async () => ({ id: "actor-id", role: state.role }),
    requireRole: (actor: { role: string }, ...allowed: string[]) => {
      if (!allowed.includes(actor.role)) throw forbidden();
    },
  };
});
vi.mock("../../src/db/transaction.js", () => ({
  withTransaction: async (callback: (client: unknown) => unknown) => {
    state.queryIndex = 0;
    return callback({
      query: async () => ({ rows: state.results[state.queryIndex++] ?? [] }),
    });
  },
}));

process.env["DATABASE_URL"] ??= "postgres://localhost/trusttask_test";
process.env["NODE_ENV"] = "test";
const { buildApp } = await import("../../src/app.js");
const app = await buildApp();
const id = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => app.ready());
afterAll(async () => app.close());

it("blocks reviewers from reversing ledger entries", async () => {
  state.role = "reviewer";
  const response = await app.inject({
    method: "POST",
    url: `/ledger/${id}/reverse`,
    payload: {
      idempotencyKey: "reviewer-cannot-reverse",
      reason: "This reversal should not be available to a reviewer.",
    },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe("FORBIDDEN");
});

it("rejects reusing a reversal key for a different ledger operation", async () => {
  state.role = "admin";
  state.results = [
    [],
    [{ id: "previous-entry", entry_type: "earning", reverses_entry_id: null }],
  ];
  const response = await app.inject({
    method: "POST",
    url: `/ledger/${id}/reverse`,
    payload: {
      idempotencyKey: "ledger-key-conflict",
      reason: "This reversal explanation is long enough for validation.",
    },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe("CONFLICT");
});

it("replays the prior reversal when the same idempotency key is repeated", async () => {
  state.role = "admin";
  state.results = [
    [],
    [
      {
        id: "previous-reversal",
        entry_type: "reversal",
        reverses_entry_id: id,
      },
    ],
  ];
  const response = await app.inject({
    method: "POST",
    url: `/ledger/${id}/reverse`,
    payload: {
      idempotencyKey: "ledger-key-replay",
      reason: "This reversal explanation is long enough for validation.",
    },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    id: "previous-reversal",
    status: "reversed",
  });
});
