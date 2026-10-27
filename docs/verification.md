# Verification record

**Recorded:** 2026-10-27 (Asia/Manila)

**Scope:** Current local workspace state. No external buyer evaluation has been performed.

## Commands and results

| Check                        | Command or procedure                     | Result                                                                                                 | Evidence and limit                                                                                                                            |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                      | `node --version`                         | **Pass** — v24.22.1                                                                                    | Meets the declared Node 24 range.                                                                                                             |
| Package manager              | `pnpm --version`                         | **Pass** — 11.25.0                                                                                     | Supplied desktop runtime; system `npm` is unavailable.                                                                                        |
| Lockfile installation        | `pnpm install --frozen-lockfile`         | **Pass**                                                                                               | Resolved from the committed lockfile in this workspace. This was not a separate clean Git clone.                                              |
| Lint                         | `pnpm lint`                              | **Pass**                                                                                               | ESLint completed successfully.                                                                                                                |
| Type check                   | `pnpm typecheck`                         | **Pass**                                                                                               | Strict TypeScript check completed successfully.                                                                                               |
| Unit tests                   | `pnpm test`                              | **Pass** — 11 files, 30 tests                                                                          | Includes Sentry redaction, actor context, role denial, and idempotency behavior tests.                                                        |
| Full coverage suite          | `pnpm coverage`                          | **Pass in CI** — 70% line/function and 60% branch gates met                                            | Runs unit plus PostgreSQL integration specs across auth, domain, HTTP, observability, and services; local run needs PostgreSQL.               |
| Formatting                   | `pnpm format:check`                      | **Pass**                                                                                               | Prettier reported all matched files formatted.                                                                                                |
| Production build             | `pnpm build`                             | **Pass**                                                                                               | TypeScript emitted `dist/`.                                                                                                                   |
| Dependency audit             | `pnpm audit --audit-level high`          | **Pass** — no known vulnerabilities reported                                                           | Registry audit is time-dependent and must be rerun in CI.                                                                                     |
| API startup                  | `pnpm start`                             | **Pass on prior revision**                                                                             | Health endpoints were verified before the latest Sentry change; the current app passes injection and hosted CI tests.                         |
| Liveness                     | `GET /health/live`                       | **Pass on prior revision**                                                                             | Returned HTTP 200 before the latest observability changes; current route injection tests pass.                                                |
| Readiness                    | `GET http://127.0.0.1:3107/health/ready` | **Blocked by missing PostgreSQL** — HTTP 503, `{"status":"not_ready"}`                                 | No server was listening on port 5432.                                                                                                         |
| PostgreSQL integration suite | `pnpm coverage`; `pnpm test:integration` | **Pass in GitHub Actions**                                                                             | Hosted run used PostgreSQL 17 and passed both coverage and integration steps. Local PostgreSQL is unavailable.                                |
| Migration and seed           | `pnpm db:migrate`; `pnpm db:seed`        | **Pass in GitHub Actions**                                                                             | Ran successfully against the hosted PostgreSQL service from a clean checkout.                                                                 |
| Docker/Compose               | `docker compose up` / image build        | **Not run**                                                                                            | Docker executable is unavailable in this environment.                                                                                         |
| GitHub Actions               | CI workflow                              | **Pass** — [run 40496460544](https://github.com/clarinz2026-dotcom/TrustTask/actions/runs/40496460544) | Clean checkout, lint, format, typecheck, unit tests, migrate, seed, coverage, integration, build, and audit all passed.                       |
| Browser workflow             | Playwright                               | **Not implemented**                                                                                    | A browser UI and browser tests remain future work; the core workflow test is HTTP-level integration coverage.                                 |
| Git history                  | `git log --oneline`                      | **9 commits, 1 author, 0-day span**                                                                    | Eight genuine follow-up commits exist, but sustained history still requires real work over coming weeks; no dates or authors were fabricated. |

## Acceptance checklist

- [x] Local lint, format, typecheck, unit tests, build, and audit pass; full coverage passes in hosted CI.
- [x] API production build succeeds and process liveness responds.
- [x] Fresh GitHub checkout installs dependencies, migrates and seeds a PostgreSQL 17 service.
- [x] HTTP/database integration and full coverage suites pass on PostgreSQL in CI.
- [ ] Docker image and Compose recovery/startup verified.
- [x] CI passes on GitHub.
- [ ] Browser workflow exists and critical workflows pass end-to-end.
- [ ] Production account bootstrap, account restrictions, support assignment, and provider reconciliation are implemented.
- [x] GitHub repository created and local commit recorded with the user's GitHub noreply identity.
- [x] Follow-up changes pushed and hosted CI reviewed.

**Readiness decision:** Not ready for independent production/buyer evaluation. Hosted CI now verifies database workflows and the coverage gates, but Docker Compose startup remains locally unverified, browser workflows and production capabilities remain incomplete, and the history dimension still needs sustained future development. No external score has been recalculated.
