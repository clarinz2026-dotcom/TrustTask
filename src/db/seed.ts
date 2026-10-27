import { hashPassword } from "../auth/session.js";
import { loadConfig } from "../config.js";
import { closePool } from "./pool.js";
import { withTransaction } from "./transaction.js";

const config = loadConfig();
if (config.NODE_ENV === "production") {
  throw new Error("Development seed data is forbidden in production");
}

const demoPassword = "trusttask-local-demo-password";
const identities = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    email: "demo-client@trusttask.local",
    name: "Demo Client",
    role: "client",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    email: "demo-contributor@trusttask.local",
    name: "Demo Contributor",
    role: "contributor",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    email: "demo-reviewer@trusttask.local",
    name: "Demo Reviewer",
    role: "reviewer",
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    email: "demo-support@trusttask.local",
    name: "Demo Support",
    role: "support",
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    email: "demo-admin@trusttask.local",
    name: "Demo Admin",
    role: "admin",
  },
] as const;

try {
  await withTransaction(async (client) => {
    for (const identity of identities) {
      await client.query(
        `INSERT INTO users (id, email, display_name, role, password_hash)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING`,
        [
          identity.id,
          identity.email,
          identity.name,
          identity.role,
          await hashPassword(demoPassword),
        ],
      );
    }
    await client.query(
      `INSERT INTO tasks (id, client_id, title, description, acceptance_criteria, budget_minor, currency, deadline, status)
       SELECT '00000000-0000-4000-8000-000000000002', id,
         'Improve an API validation boundary',
         'Add precise validation to one endpoint and document the expected error response for invalid input.',
         ARRAY['Reject malformed payloads with a stable validation error', 'Add tests for valid and invalid inputs'],
         15000, 'USD', now() + interval '14 days', 'published'
       FROM users WHERE email = 'demo-client@trusttask.local'
       ON CONFLICT (id) DO NOTHING`,
    );
  });
  process.stdout.write(
    `Local demo users and task are present. Demo password: ${demoPassword}\n`,
  );
} finally {
  await closePool();
}
