import type { FastifyRequest } from "fastify";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../../src/db/pool.js", () => ({
  getPool: () => ({
    query: async () => ({ rows: state.rows }),
  }),
  closePool: vi.fn(),
}));

process.env["DATABASE_URL"] ??= "postgres://localhost/trusttask_test";
process.env["SESSION_SECRET"] =
  "test-only-trusttask-secret-that-is-longer-than-32";

const { actorFromRequest, createSessionToken } =
  await import("../../src/auth/session.js");

it("attaches the authenticated actor for request-scoped structured logs", async () => {
  const actor = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "contributor@example.test",
    role: "contributor",
  } as const;
  state.rows = [actor];
  const request = {
    headers: {
      authorization: `Bearer ${createSessionToken(actor.id)}`,
    },
    actor: null,
  } as unknown as FastifyRequest;

  await expect(actorFromRequest(request)).resolves.toEqual(actor);
  expect(request.actor).toEqual(actor);
});
