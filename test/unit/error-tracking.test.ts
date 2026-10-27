import { describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  init: sentry.init,
  captureException: sentry.captureException,
  withScope: (callback: (scope: { setTag: typeof sentry.setTag }) => void) =>
    callback({ setTag: sentry.setTag }),
}));

const { captureServerError, configureErrorTracking } =
  await import("../../src/observability/error-tracking.js");

describe("optional error reporting", () => {
  it("does nothing when no Sentry DSN is configured", () => {
    configureErrorTracking(undefined, "test");
    captureServerError(new Error("hidden"), {
      requestId: "request-1",
      route: "/example",
      actorId: undefined,
    });
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("initializes with PII disabled and tags captured errors", () => {
    configureErrorTracking("https://public@example.ingest.sentry.io/1", "test");
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "test",
        sendDefaultPii: false,
        tracesSampleRate: 0,
      }),
    );
    const options = sentry.init.mock.calls[0]?.[0] as {
      beforeSend: (event: {
        request?: unknown;
        user?: unknown;
        message?: string;
      }) => unknown;
    };
    expect(
      options.beforeSend({
        request: { headers: { authorization: "secret" } },
        user: { email: "private@example.test" },
        message: "sanitized event",
      }),
    ).toEqual({ message: "sanitized event" });

    const error = new Error("database unavailable");
    captureServerError(error, {
      requestId: "request-2",
      route: "/tasks/:id",
      actorId: "actor-1",
    });
    expect(sentry.setTag).toHaveBeenCalledWith("request_id", "request-2");
    expect(sentry.setTag).toHaveBeenCalledWith("route", "/tasks/:id");
    expect(sentry.setTag).toHaveBeenCalledWith("actor_id", "actor-1");
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });
});
