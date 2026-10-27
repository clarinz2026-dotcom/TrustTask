import { Counter, Histogram, Registry } from "@prometheus-io/client";

const registry = new Registry();
registry.setDefaultLabels({ service: "trusttask-api" });

const requestCount = new Counter({
  name: "trusttask_http_requests_total",
  help: "Completed HTTP requests handled by TrustTask.",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});

const requestDuration = new Histogram({
  name: "trusttask_http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export function recordHttpRequest(
  labels: { method: string; route: string; status_code: string },
  durationMs: number,
): void {
  requestCount.inc(labels);
  requestDuration.observe(labels, durationMs / 1000);
}

export function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export const metricsContentType = registry.contentType;
