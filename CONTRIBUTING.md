# Contributing

Use Node.js 24.x and pnpm 11.25.0. Copy `.env.example` to `.env`, start PostgreSQL with `docker compose up -d db`, then run `pnpm install --frozen-lockfile`, `pnpm db:migrate`, and `pnpm db:seed`.

Before submitting changes, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, and `pnpm build`. Integration tests use `DATABASE_URL` and require a migrated, isolated database. Never use production credentials or real payment transactions in tests.

Keep business rules out of HTTP handlers and UI components. Put state transitions and financial calculations in independently tested domain modules. A behavior change should include meaningful positive and negative assertions and corresponding documentation. Do not add dependencies or claim verification unless the command was actually run and its result inspected.
