# Security policy

TrustTask is an early-stage API and is not ready for production use. The current code has role-checked bearer sessions and marketplace routes, but PostgreSQL-backed behavior has not been verified here. Production account recovery, a first-admin bootstrap, browser protections, file handling, and external payment integrations are not implemented.

Do not report vulnerabilities through public issues. Contact the repository owner privately with a clear description, impact, and reproduction steps. Do not include real credentials or personal data in reports.

Security expectations for contributions: keep production secrets out of source, use synthetic local data, validate all user-controlled input server-side, enforce object-level authorization, avoid logging credentials or unnecessary personal data, and add negative tests for security-sensitive behavior. Audit and ledger history have database-level update/delete guards. Demo credentials are local-only; the seed command refuses `NODE_ENV=production`. Set a unique `SESSION_SECRET` through a secret manager before production use.
