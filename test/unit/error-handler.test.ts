import { afterAll, expect, it, vi } from "vitest";

const tracking = vi.hoisted(() => ({
  capture: vi.fn(),
  configure: vi.fn(),
}));

vi.mock("../../src/observability/error-tracking.js", () => ({
  captureServerError: tracking.capture,
  configureErrorTracking: tracking.configure,
}));

process.env["DATABASE_URL"] ??= "postgres://localhost/trusttask_test";
process.env["NODE_ENV"] = "test";
const { buildApp } = await import("../../src/app.js");
const app = await buildApp();
const internalError = new Error("private database error");
app.get("/test/tracked-error", async () => {
  throw internalError;
});
await app.ready();

afterAll(async () => app.close());

it("reports unexpected server errors with request and actor context", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/test/tracked-error",
  });
  expect(response.statusCode).toBe(500);
  expect(tracking.capture).toHaveBeenCalledWith(
    internalError,
    expect.objectContaining({
      requestId: expect.any(String),
      route: "/test/tracked-error",
      actorId: undefined,
    }),
  );
});
