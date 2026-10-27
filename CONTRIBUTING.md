# Contributing

Use Node.js 24.x and pnpm 11.25.0. Run `pnpm install --frozen-lockfile`, then `docker compose up -d --build` to build and start the API and PostgreSQL. For database-backed tests, use `pnpm test:ci` to start a separate isolated database.

Before submitting changes, run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm test:ci`, and `pnpm build`. Integration tests use `DATABASE_URL` and require a migrated, isolated database. Never use production credentials or real payment transactions in tests.

For a clean local database-backed verification, `pnpm test:ci` starts an isolated PostgreSQL service on port 5433, runs migrations, seeds demo data, executes integration tests, and removes the service. It requires Docker Compose and pnpm. Dependency update pull requests are opened weekly by Dependabot; review the release notes and audit output, run the quality commands, and check for migration or security changes before merging.

Keep business rules out of HTTP handlers and UI components. Put state transitions and financial calculations in independently tested domain modules. A behavior change should include meaningful positive and negative assertions and corresponding documentation. Do not add dependencies or claim verification unless the command was actually run and its result inspected.
