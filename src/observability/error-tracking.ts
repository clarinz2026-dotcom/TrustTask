import * as Sentry from "@sentry/node";

let configured = false;

export function configureErrorTracking(
  dsn: string | undefined,
  environment: string,
): void {
  if (!dsn || configured) return;
  Sentry.init({
    dsn,
    environment,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return event;
    },
  });
  configured = true;
}

export function captureServerError(
  error: unknown,
  context: { requestId: string; route: string; actorId: string | undefined },
): void {
  if (!configured) return;
  Sentry.withScope((scope) => {
    scope.setTag("request_id", context.requestId);
    scope.setTag("route", context.route);
    if (context.actorId) scope.setTag("actor_id", context.actorId);
    Sentry.captureException(error);
  });
}
