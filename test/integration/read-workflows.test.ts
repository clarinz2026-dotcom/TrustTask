import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { closePool } from "../../src/db/pool.js";

const demoPassword = "trusttask-local-demo-password";
const app = await buildApp();

beforeAll(async () => {
  if (!process.env["DATABASE_URL"])
    throw new Error("DATABASE_URL is required for integration tests");
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password: demoPassword },
  });
  expect(response.statusCode).toBe(200);
  return response.json().token as string;
}

function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

it("serves scoped dashboards for every demo role", async () => {
  const roles = [
    ["demo-client@trusttask.local", "client"],
    ["demo-contributor@trusttask.local", "contributor"],
    ["demo-reviewer@trusttask.local", "reviewer"],
    ["demo-support@trusttask.local", "support"],
    ["demo-admin@trusttask.local", "admin"],
  ] as const;

  for (const [email, role] of roles) {
    const token = await login(email);
    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe(role);
  }
});

it("keeps support conversations private and marks owner notifications read", async () => {
  const contributor = await login("demo-contributor@trusttask.local");
  const support = await login("demo-support@trusttask.local");
  const label = randomUUID();
  const opened = await app.inject({
    method: "POST",
    url: "/support/cases",
    headers: bearer(contributor),
    payload: {
      category: "other",
      subject: `Private support case ${label}`,
      message: "Please help with this private account question.",
    },
  });
  expect(opened.statusCode).toBe(201);
  const caseId = opened.json().id as string;

  const ownerCases = await app.inject({
    method: "GET",
    url: "/support/cases",
    headers: bearer(contributor),
  });
  expect(
    ownerCases.json().items.some((item: { id: string }) => item.id === caseId),
  ).toBe(true);
  const firstMessages = await app.inject({
    method: "GET",
    url: `/support/cases/${caseId}/messages`,
    headers: bearer(contributor),
  });
  expect(firstMessages.statusCode).toBe(200);
  expect(firstMessages.json().items).toHaveLength(1);

  const strangerRegistration = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `stranger-${label}@trusttask.local`,
      displayName: "Unrelated user",
      password: "another-local-password-123",
      role: "contributor",
    },
  });
  const stranger = strangerRegistration.json().token as string;
  const hidden = await app.inject({
    method: "GET",
    url: `/support/cases/${caseId}/messages`,
    headers: bearer(stranger),
  });
  expect(hidden.statusCode).toBe(404);

  const ownerReply = await app.inject({
    method: "POST",
    url: `/support/cases/${caseId}/messages`,
    headers: bearer(contributor),
    payload: { body: "I have added one more detail for support." },
  });
  expect(ownerReply.statusCode).toBe(201);
  const supportCases = await app.inject({
    method: "GET",
    url: "/support/cases",
    headers: bearer(support),
  });
  expect(
    supportCases
      .json()
      .items.some((item: { id: string }) => item.id === caseId),
  ).toBe(true);
  const supportReply = await app.inject({
    method: "POST",
    url: `/support/cases/${caseId}/messages`,
    headers: bearer(support),
    payload: { body: "We received your message and will review it." },
  });
  expect(supportReply.statusCode).toBe(201);

  const notifications = await app.inject({
    method: "GET",
    url: "/notifications",
    headers: bearer(contributor),
  });
  const notification = notifications
    .json()
    .items.find(
      (item: { event_type: string; target_id: string }) =>
        item.event_type === "support.updated" && item.target_id === caseId,
    );
  expect(notification).toBeDefined();
  const markedRead = await app.inject({
    method: "POST",
    url: `/notifications/${notification.id}/read`,
    headers: bearer(contributor),
  });
  expect(markedRead.statusCode).toBe(200);

  const resolved = await app.inject({
    method: "POST",
    url: `/support/cases/${caseId}/resolve`,
    headers: bearer(support),
    payload: {
      explanation: "The support question has been reviewed and answered.",
    },
  });
  expect(resolved.statusCode).toBe(200);
  const closedReply = await app.inject({
    method: "POST",
    url: `/support/cases/${caseId}/messages`,
    headers: bearer(contributor),
    payload: { body: "This new message must be rejected after resolution." },
  });
  expect(closedReply.statusCode).toBe(409);
});
