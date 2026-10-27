import { afterAll, beforeAll, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "reviewer" }));
vi.mock("../../src/auth/session.js", async () => {
  const { forbidden } = await import("../../src/http/errors.js");
  return {
    actorFromRequest: async () => ({ id: "actor-id", role: state.role }),
    requireRole: (actor: { role: string }, ...allowed: string[]) => {
      if (!allowed.includes(actor.role)) throw forbidden();
    },
  };
});

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
