import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";

let app: FastifyInstance;

beforeAll(async () => {
  if (!process.env["DATABASE_URL"])
    throw new Error("DATABASE_URL is required for integration tests");
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await closePool();
});

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password: "trusttask-local-demo-password" },
  });
  expect(response.statusCode).toBe(200);
  return response.json().token as string;
}

function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describe("marketplace workflow", () => {
  it("publishes, revises, approves, records one earning, simulates payment, and resolves support", async () => {
    const clientToken = await login("demo-client@trusttask.local");
    const contributorToken = await login("demo-contributor@trusttask.local");
    const reviewerToken = await login("demo-reviewer@trusttask.local");
    const supportToken = await login("demo-support@trusttask.local");
    const adminToken = await login("demo-admin@trusttask.local");
    const reviewerId = await getReviewerId();
    const label = randomUUID();

    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: bearer(clientToken),
      payload: {
        title: `Integration task ${label}`,
        description:
          "Complete a small validation change and provide the requested evidence.",
        acceptanceCriteria: [
          "Reject invalid values",
          "Include passing and failing tests",
        ],
        budgetMinor: "10005",
        currency: "USD",
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;
    const draft = await app.inject({
      method: "GET",
      url: `/tasks/${taskId}`,
      headers: bearer(clientToken),
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().status).toBe("draft");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/tasks/${taskId}/publish`,
          headers: bearer(clientToken),
        })
      ).statusCode,
    ).toBe(200);
    const listed = await app.inject({
      method: "GET",
      url: `/tasks?search=${label}`,
    });
    expect(listed.json().items).toHaveLength(1);

    const publicTask = await app.inject({
      method: "GET",
      url: `/tasks/${taskId}`,
    });
    expect(publicTask.statusCode).toBe(200);

    const claim = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/claim`,
      headers: bearer(contributorToken),
    });
    expect(claim.statusCode).toBe(201);
    const assignmentId = claim.json().id as string;
    for (const token of [clientToken, contributorToken]) {
      const assignments = await app.inject({
        method: "GET",
        url: "/assignments",
        headers: bearer(token),
      });
      expect(assignments.statusCode).toBe(200);
    }
    const first = await app.inject({
      method: "POST",
      url: `/assignments/${assignmentId}/submissions`,
      headers: bearer(contributorToken),
      payload: {
        evidence:
          "The implementation and initial test report are ready for review.",
      },
    });
    expect(first.statusCode).toBe(201);
    const firstSubmission = first.json().id as string;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/reviews/assign`,
          headers: bearer(adminToken),
          payload: { submissionId: firstSubmission, reviewerId },
        })
      ).statusCode,
    ).toBe(200);
    const conflicted = await app.inject({
      method: "POST",
      url: `/reviews/${firstSubmission}/conflict`,
      headers: bearer(reviewerToken),
      payload: { reason: "A conflict needs reassignment before this review." },
    });
    expect(conflicted.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/reviews/assign",
          headers: bearer(adminToken),
          payload: { submissionId: firstSubmission, reviewerId },
        })
      ).statusCode,
    ).toBe(200);
    const queue = await app.inject({
      method: "GET",
      url: "/reviews/queue",
      headers: bearer(reviewerToken),
    });
    expect(
      queue
        .json()
        .items.some(
          (item: { submission_id: string }) =>
            item.submission_id === firstSubmission,
        ),
    ).toBe(true);

    const revision = await app.inject({
      method: "POST",
      url: `/submissions/${firstSubmission}/review`,
      headers: bearer(reviewerToken),
      payload: {
        decision: "request_revision",
        reason: "Add a test for a missing field before approval.",
      },
    });
    expect(revision.statusCode).toBe(200);
    expect(revision.json().status).toBe("revision_requested");

    const second = await app.inject({
      method: "POST",
      url: `/assignments/${assignmentId}/submissions`,
      headers: bearer(contributorToken),
      payload: {
        evidence: "Added the missing field test and reran the focused checks.",
      },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().version).toBe(2);
    const secondSubmission = second.json().id as string;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/reviews/assign",
          headers: bearer(adminToken),
          payload: { submissionId: secondSubmission, reviewerId },
        })
      ).statusCode,
    ).toBe(200);

    const approve = () =>
      app.inject({
        method: "POST",
        url: `/submissions/${secondSubmission}/review`,
        headers: bearer(reviewerToken),
        payload: {
          decision: "approve",
          reason: "Both acceptance criteria have evidence and tests.",
        },
      });
    const concurrent = await Promise.all([approve(), approve()]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);

    const earnings = await app.inject({
      method: "GET",
      url: "/earnings",
      headers: bearer(contributorToken),
    });
    const earned = earnings
      .json()
      .items.filter((entry: { task_id: string }) => entry.task_id === taskId);
    expect(earned).toHaveLength(1);
    expect(earned[0].gross_minor).toBe("10005");
    expect(earned[0].fee_minor).toBe("1001");
    expect(earned[0].net_minor).toBe("9004");

    const key = randomUUID();
    const paymentPath = `/ledger/${earned[0].id}/simulate-payment`;
    const simulated = await app.inject({
      method: "POST",
      url: paymentPath,
      headers: bearer(adminToken),
      payload: { idempotencyKey: key, outcome: "paid" },
    });
    expect(simulated.statusCode).toBe(200);
    expect(simulated.json()).toMatchObject({ status: "paid", simulated: true });
    const attempts = await app.inject({
      method: "GET",
      url: `/ledger/${earned[0].id}/payment-attempts`,
      headers: bearer(contributorToken),
    });
    expect(attempts.statusCode).toBe(200);
    expect(attempts.json().items).toHaveLength(1);
    const duplicate = await app.inject({
      method: "POST",
      url: paymentPath,
      headers: bearer(adminToken),
      payload: { idempotencyKey: key, outcome: "paid" },
    });
    expect(duplicate.json().id).toBe(simulated.json().id);

    const reversalKey = randomUUID();
    const reversal = await app.inject({
      method: "POST",
      url: `/ledger/${earned[0].id}/reverse`,
      headers: bearer(adminToken),
      payload: {
        idempotencyKey: reversalKey,
        reason:
          "Reverse the local demo earning to verify correction accounting.",
      },
    });
    expect(reversal.statusCode).toBe(200);
    expect(reversal.json().status).toBe("reversed");
    const repeatedReversal = await app.inject({
      method: "POST",
      url: `/ledger/${earned[0].id}/reverse`,
      headers: bearer(adminToken),
      payload: {
        idempotencyKey: reversalKey,
        reason:
          "Reverse the local demo earning to verify correction accounting.",
      },
    });
    expect(repeatedReversal.json().id).toBe(reversal.json().id);

    const openedCase = await app.inject({
      method: "POST",
      url: "/support/cases",
      headers: bearer(contributorToken),
      payload: {
        category: "payment",
        subject: `Payment question ${label}`,
        message: "Please explain the local payment status shown for this task.",
        taskId,
      },
    });
    expect(openedCase.statusCode).toBe(201);
    const caseId = openedCase.json().id as string;
    const resolved = await app.inject({
      method: "POST",
      url: `/support/cases/${caseId}/resolve`,
      headers: bearer(supportToken),
      payload: {
        explanation:
          "The status comes from the local simulator and no funds moved.",
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().status).toBe("resolved");

    const appealTask = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: bearer(clientToken),
      payload: {
        title: `Appeal test ${label}`,
        description:
          "A second isolated task verifies the rejection appeal workflow.",
        acceptanceCriteria: ["Include an explanation"],
        budgetMinor: "5000",
        currency: "USD",
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(appealTask.statusCode).toBe(201);
    const appealTaskId = appealTask.json().id as string;
    await app.inject({
      method: "POST",
      url: `/tasks/${appealTaskId}/publish`,
      headers: bearer(clientToken),
    });
    const appealAssignment = await app.inject({
      method: "POST",
      url: `/tasks/${appealTaskId}/claim`,
      headers: bearer(contributorToken),
    });
    const appealSubmission = await app.inject({
      method: "POST",
      url: `/assignments/${appealAssignment.json().id}/submissions`,
      headers: bearer(contributorToken),
      payload: {
        evidence:
          "The work is submitted to test the rejection and appeal policy.",
      },
    });
    const appealSubmissionId = appealSubmission.json().id as string;
    await app.inject({
      method: "POST",
      url: "/reviews/assign",
      headers: bearer(adminToken),
      payload: { submissionId: appealSubmissionId, reviewerId },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/submissions/${appealSubmissionId}/review`,
          headers: bearer(reviewerToken),
          payload: {
            decision: "reject",
            reason: "The required evidence is not present in this version.",
          },
        })
      ).statusCode,
    ).toBe(200);
    const appeal = await app.inject({
      method: "POST",
      url: `/submissions/${appealSubmissionId}/appeals`,
      headers: bearer(contributorToken),
      payload: {
        reason:
          "The reviewer overlooked the evidence attached to this submission.",
      },
    });
    expect(appeal.statusCode).toBe(201);
    const appealResolution = await app.inject({
      method: "POST",
      url: `/appeals/${appeal.json().id}/resolve`,
      headers: bearer(supportToken),
      payload: {
        outcome: "overturned",
        explanation:
          "The record shows the reviewer missed the attached evidence; revision is permitted.",
      },
    });
    expect(appealResolution.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/submissions/${appealSubmissionId}`,
          headers: bearer(contributorToken),
        })
      ).json().status,
    ).toBe("revision_requested");
    const appealedRevision = await app.inject({
      method: "POST",
      url: `/assignments/${appealAssignment.json().id}/submissions`,
      headers: bearer(contributorToken),
      payload: {
        evidence:
          "Updated evidence after the appeal outcome restored this assignment.",
      },
    });
    expect(appealedRevision.statusCode).toBe(201);
    expect(appealedRevision.json().version).toBe(2);

    const strangerResponse = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `stranger-${label}@trusttask.local`,
        displayName: "Stranger",
        password: "another-local-password-123",
        role: "contributor",
      },
    });
    const strangerToken = strangerResponse.json().token as string;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/submissions/${secondSubmission}`,
          headers: bearer(strangerToken),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tasks",
          headers: bearer(contributorToken),
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
});

async function getReviewerId(): Promise<string> {
  const result = await getPool().query(
    "SELECT id FROM users WHERE email='demo-reviewer@trusttask.local'",
  );
  return result.rows[0]!.id as string;
}
