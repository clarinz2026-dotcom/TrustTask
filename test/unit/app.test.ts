import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env["DATABASE_URL"] ??= "postgres://localhost/trusttask_test";
process.env["NODE_ENV"] = "test";

const { buildApp } = await import("../../src/app.js");
const app = await buildApp();

beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe("HTTP foundation", () => {
  it("serves a liveness response without exposing runtime details", async () => {
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("exposes request counts and latency in Prometheus text format", async () => {
    await app.inject({ method: "GET", url: "/health/live" });
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("trusttask_http_requests_total");
    expect(response.body).toContain('route="/health/live"');
    expect(response.body).toContain("trusttask_http_request_duration_seconds");
  });

  it("returns a stable and safe missing-resource error", async () => {
    const response = await app.inject({ method: "GET", url: "/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
    expect(response.json().error.requestId).toEqual(expect.any(String));
  });

  it("returns a stable validation error before authentication database access", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "Login fields are invalid" },
    });
  });

  it("keeps internal details out of unexpected error responses", async () => {
    const errorApp = await buildApp();
    errorApp.get("/test/unexpected-error", async () => {
      throw new Error("internal database connection string");
    });
    await errorApp.ready();
    try {
      const response = await errorApp.inject({
        method: "GET",
        url: "/test/unexpected-error",
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("connection string");
      expect(response.json().error.code).toBe("INTERNAL_ERROR");
    } finally {
      await errorApp.close();
    }
  });
});
