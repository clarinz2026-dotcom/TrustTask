import { afterAll, beforeAll, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "contributor",
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

it("blocks contributors from simulating administrative payments", async () => {
  state.role = "contributor";
  const response = await app.inject({
    method: "POST",
    url: `/ledger/${id}/simulate-payment`,
    payload: { idempotencyKey: "payment-not-for-user", outcome: "paid" },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe("FORBIDDEN");
});

it("rejects a payment idempotency key reused for another request", async () => {
  state.role = "admin";
  state.results = [
    [],
    [
      {
        id: "previous-attempt",
        ledger_entry_id: "another-ledger-entry",
        requested_outcome: "paid",
      },
    ],
  ];
  const response = await app.inject({
    method: "POST",
    url: `/ledger/${id}/simulate-payment`,
    payload: { idempotencyKey: "payment-key-conflict", outcome: "paid" },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe("CONFLICT");
});

it("replays a matching payment attempt with the same idempotency key", async () => {
  state.role = "admin";
  state.results = [
    [],
    [
      {
        id: "previous-attempt",
        ledger_entry_id: id,
        requested_outcome: "paid",
        status: "paid",
        provider_reference: "local-previous-reference",
        created_at: "2026-10-27T00:00:00.000Z",
      },
    ],
  ];
  const response = await app.inject({
    method: "POST",
    url: `/ledger/${id}/simulate-payment`,
    payload: { idempotencyKey: "payment-key-replay", outcome: "paid" },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    id: "previous-attempt",
    simulated: true,
    requested_outcome: "paid",
  });
});
