# Engineering task catalog

These are bounded future engineering opportunities. Status is evidence-based; none is marked complete because the database-backed integration suite has not yet run in this environment.

## TT-001 — Harden and complete identity lifecycle

- **Module:** Identity and access
- **Status:** Implemented, verification pending; production lifecycle incomplete.
- **Current behavior:** Registration supports contributor/client roles, scrypt password hashes, one-hour signed bearer sessions, login throttling, and current-role reads from PostgreSQL. Local seed creates synthetic identities for every role.
- **Expected behavior:** Production identity lifecycle supports secure account recovery, revocation, restrictions, and a controlled first-admin bootstrap.
- **Acceptance criteria:** Add tested recovery and token revocation; audit account restrictions/role changes; establish a reviewed production bootstrap; negative tests prove cross-user access and escalation fail closed.
- **Verification:** `pnpm test`, `pnpm test:integration`, `pnpm typecheck`
- **Constraints:** Never allow self-registration into privileged roles or a universal admin bypass.
- **Expected interfaces:** Identity, session, bootstrap, and policy services.
- **Out of scope:** Third-party identity providers.
- **Dependencies:** PostgreSQL migrations and auth routes.

## TT-002 — Complete task eligibility and edit policies

- **Module:** Tasks
- **Status:** Core API implemented; database/HTTP verification pending.
- **Current behavior:** Client draft creation/edit/publication/closure and public search use server validation, ownership checks, deadlines, acceptance criteria, integer budgets, and audit records.
- **Expected behavior:** Eligibility, capacity, and task-specific revision policies are explicit and discoverable.
- **Acceptance criteria:** Add bounded pagination/filtering tests, concurrent claim tests, full object authorization tests, and documented capacity/eligibility rules.
- **Verification:** Domain, HTTP, and PostgreSQL integration tests.
- **Constraints:** No real escrow. Existing assignments remain auditable when a task closes.
- **Expected interfaces:** Task application service and eligibility policy.
- **Out of scope:** External payment funding.
- **Dependencies:** Identity and task schema.

## TT-003 — Complete submission/review operations

- **Module:** Submissions and reviews
- **Status:** Core workflow and assigned reviewer policy implemented; database/HTTP verification pending.
- **Current behavior:** Versioned submissions, admin assignment, reviewer conflict declaration, revision cap, stale-decision rejection, and reasoned review decisions are implemented.
- **Expected behavior:** Review assignments are available to authorized operations staff, conflicts are resolved, and every version has a deterministic final outcome.
- **Acceptance criteria:** Verify concurrent decisions, cross-user evidence access, reassignment after conflict, revision limit, and audit consistency against PostgreSQL.
- **Verification:** `pnpm test:integration` on an isolated PostgreSQL database.
- **Constraints:** Rejection and revision decisions require an explanation; reviews target one submission version.
- **Expected interfaces:** Review assignment policy and review service.
- **Out of scope:** Automated AI review decisions.
- **Dependencies:** TT-001, TT-002.

## TT-004 — Verify and extend ledger/provider operations

- **Module:** Ledger and payment adapter
- **Status:** Integer-minor-unit earning, idempotency, append-only reversal, and local simulator implemented; provider reconciliation and database verification pending.
- **Current behavior:** Approval creates one earning with a 10% half-up rounded fee. Admin corrections append reversal entries. A local-only adapter records payment attempts and events.
- **Expected behavior:** Reconcile externally delivered provider events and support operational reporting for retryable failures.
- **Acceptance criteria:** Prove idempotency, rollback, fee arithmetic, append-only history, concurrent approval, and event reconciliation with tests; keep real-money capability disabled until separately reviewed.
- **Verification:** Unit arithmetic tests and PostgreSQL integration tests.
- **Constraints:** No binary floating point, real funds custody, or simulated-as-real claims.
- **Expected interfaces:** Ledger service and payment provider contract.
- **Out of scope:** Real payment provider integration.
- **Dependencies:** TT-003.

## TT-005 — Add the browser client and end-to-end workflow

- **Module:** Presentation and reporting
- **Status:** Not implemented.
- **Current behavior:** Role-scoped dashboard and list data are available only through the API.
- **Expected behavior:** Accessible React/Vite client supports contributor, client, reviewer, and support workflows.
- **Acceptance criteria:** Implement login, role dashboards, task browse/publish, submission/review, earnings, support and appeal flows; Playwright tests cover the critical workflow and cross-user protections.
- **Verification:** `pnpm test:e2e` plus API integration suite.
- **Constraints:** UI must not contain authoritative business rules or financial calculations.
- **Expected interfaces:** API endpoints documented in `docs/api.md`.
- **Out of scope:** Native mobile clients.
- **Dependencies:** API workflow verification.
