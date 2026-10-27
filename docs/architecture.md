# Architecture and implementation status

## Current implementation

The repository is an early-stage modular monolith. Fastify provides the HTTP boundary, Zod validates input/configuration, `pg` provides PostgreSQL access, SQL files define versioned schema changes, and Vitest runs unit and database integration tests. Passwords use Node scrypt; signed one-hour bearer sessions resolve the current role from the database on each request. The API implements task, assignment, versioned submission/review, earnings ledger, local payment simulation, support, appeal, in-app notification, and scoped dashboard endpoints. There is not yet a frontend.

The schema stores user role labels, task metadata, assignments, submission/review history, immutable earning/reversal entries, local payment attempts, support/appeal records, notifications, and append-only audit events. Monetary values are integer minor units with an uppercase three-character currency field. Authentication and role checks run in API handlers; PostgreSQL foreign keys, constraints, uniqueness, and row locks backstop invariants. Database workflows remain unverified locally while PostgreSQL/Docker are unavailable.

## Intended boundaries

`src/app.ts` owns HTTP setup and safe error responses. `src/config.ts` validates runtime configuration. `src/db` owns connection access, transactions, migration, seed, and schema files. `src/domain` contains review transitions and exact fee arithmetic; `src/auth` owns password/session primitives; `src/services` owns audit/notification writes; `src/adapters` isolates the local payment simulator; `src/http` contains endpoint request/authorization orchestration. Additional refactoring into application services is appropriate as modules expand.

## Deferred decisions

- ORM/query layer: remain on parameterized `pg` queries until workflow complexity justifies an ORM.
- UI framework: React/Vite is the proposed client, deferred; the current product has no web UI.
- Payment processing: local simulator only; no real funds custody or transfers.
- Evidence files: defer uploads until retention, malware scanning, authorization, and storage are designed.
- Notifications: local adapter first; external delivery remains optional.

## Local persistence and recovery

Compose stores PostgreSQL data in a named volume. Preserve and back up the volume before destructive local maintenance. For a clean local database, use `docker compose down -v` only when the local data is intentionally disposable, then start `docker compose up -d db` and rerun `pnpm db:migrate` and `pnpm db:seed`. Deployment backup and restore procedures must be tested against the selected PostgreSQL hosting provider.

## Verification status

See [verification status](verification.md) for commands, results, evidence, and environment-dependent limitations. A passing build or unit test does not establish production readiness or external buyer acceptance.
