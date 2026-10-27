# TrustTask

TrustTask is an early-stage API marketplace for software engineering tasks and AI evaluation work. It includes role-checked task, submission, review, ledger, local payment simulation, support, appeal, notification, and dashboard endpoints. It is not production-ready: there is no web UI, and database-backed workflows have not yet been verified in this environment.

## Phase 0 architecture proposal

### Architecture and module boundaries

Use a TypeScript modular monolith: a React/Vite client, a Node.js HTTP API, PostgreSQL, and one deployable application. Keep presentation, HTTP validation, authentication/authorization, domain rules, application services, persistence, and adapters in separate modules. Prefer explicit service calls and database transactions over distributed infrastructure.

Initial modules: identity and access; tasks and assignments; submissions and reviews; ledger and payment simulator; support and appeals; audit; notifications; reporting. All state-changing operations pass through application services, enforce role and object scope server-side, and write audit events in the same transaction when applicable.

### Data model proposal

Start with users and roles; tasks and acceptance criteria; assignments; versioned submissions; reviews; append-only ledger entries; support cases, messages, and appeals; audit events; notifications; and idempotency keys. Use UUID primary keys, foreign keys, explicit currency plus integer minor units, indexes for browse and inbox queries, unique idempotency keys, and restrictive deletion for financial/audit history. Add payment attempts/provider events only with the simulator adapter. Defer stored file uploads and real provider custody.

### Threat model

Protect against cross-user object access, role escalation, forged or stale review actions, mass assignment, duplicate financial events, SQL injection, password/session compromise, unsafe uploads, and sensitive-data leakage in errors/logs. Validate at the API boundary and again through domain invariants; use parameterized queries, password hashing, short-lived authenticated sessions, least-privilege roles, rate limits on authentication and decisions, audit sensitive operations, and keep secrets outside source control. The local payment simulator must never imply real funds movement.

### Test strategy

Pure domain tests cover transitions, revision limits, eligibility, exact fee arithmetic, idempotency, authorization, appeal eligibility, and reports. PostgreSQL integration tests cover migrations, constraints, transaction rollback and concurrent writes. HTTP tests exercise authentication, validation, error shape and object authorization. Browser tests target client publish → contributor submit → review/revision → approval → ledger, plus private support access. Use deterministic fixtures and a mock notification adapter. Measure coverage for critical domain rules rather than treating a percentage as proof.

### Environment and acceptance criteria

Use a committed pnpm lockfile; pin the supported Node major; require PostgreSQL through a documented Compose service; validate configuration at startup; provide safe `.env.example` defaults; and keep external email/payment providers optional. A phase is accepted only when its documented commands run successfully and the recorded report distinguishes verified, unverified, and deferred work. Fresh setup must cover install, database start, migration, seed, lint, typecheck, unit/integration tests, build, startup and health response.

### Implementation sequence

1. Foundation: repository scripts, strict TypeScript, formatting/linting, API startup, configuration validation, initial schema/migration, Compose, CI, and test harness.
2. Core task, assignment, submission and review workflows with centralized transitions and authorization.
3. Integer-minor-unit append-only ledger, idempotency, simulator and atomic audit events.
4. Scoped support cases and appeals with decision records.
5. Role-specific reporting and UI workflows.
6. Fresh-clone, security, migration, concurrency and documentation review.

### Major risks and dependencies

The current environment has Node.js 24 but no `npm` or Docker executable on PATH. The desktop provides pnpm 11.25.0, which will be used for package management; Docker-backed PostgreSQL and container verification remain unavailable until Docker is installed. No repository history or existing product code was present at discovery.

## Current status

Phase 0 proposal and Phase 1 foundation are documented. No external evaluator, payment provider, email provider, or production deployment is configured.

## Requirements and local setup

- Node.js 24.x
- pnpm 11.25.0 (`corepack enable` then `corepack prepare pnpm@11.25.0 --activate`, or use an installed pnpm)
- Docker with the Compose plugin for PostgreSQL

```powershell
Copy-Item .env.example .env
docker compose up -d db
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The API listens on port 3000. `GET /health/live` checks that the process is responding; `GET /health/ready` checks the PostgreSQL connection. Seed data is for local development only and is refused when `NODE_ENV=production`. The demo password is printed by the seed command; demo identities cover client, contributor, reviewer, support, and admin roles.

## Quality commands

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Integration tests write synthetic data and should use a disposable database. CI supplies an isolated PostgreSQL service. For local verification, create a separate database, set `DATABASE_URL` to it, then run migration, seed, and integration commands:

```powershell
docker compose exec -T db createdb -U trusttask trusttask_test
$env:DATABASE_URL = "postgres://trusttask:trusttask_local_only@localhost:5432/trusttask_test"
pnpm db:migrate
pnpm db:seed
pnpm test:integration
```

Formatting can be checked with `pnpm format:check`.

## Data and deployment notes

The SQL migrations create users, tasks, assignments, versioned submissions, reviews, ledger entries, payment attempts/events, support cases, appeals, notifications, and audit events. The migration runner tracks applied versions and applies outstanding migrations transactionally. `pnpm db:seed` is repeatable for deterministic demo identities and task. Do not put production credentials in `.env.example`; local Compose credentials are intentionally non-production.

For deployment, provide PostgreSQL backups with tested restore procedures, use managed secret storage, TLS at the ingress, a least-privilege database role, and a separately reviewed migration process. Compose is a local development configuration, not a production deployment topology. The payment simulator is local only; no payment custody, external provider, email/SMS delivery, file upload, or operational response-time guarantee is implemented.

## Documentation map

- [Architecture and current scope](docs/architecture.md)
- [API routes and semantics](docs/api.md)
- [Verification status](docs/verification.md)
- [Security policy](SECURITY.md)
- [Contribution and verification guide](CONTRIBUTING.md)
- [Engineering task catalog](docs/task-catalog.md)
- [ADR 0001: modular monolith](docs/adr/0001-modular-monolith.md)
