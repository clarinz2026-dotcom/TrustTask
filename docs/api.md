# HTTP API

The API returns JSON. Except for health, registration, login, and public task browsing, routes require `Authorization: Bearer <token>`. Tokens expire after one hour; the user's current role is read from PostgreSQL on every authenticated request. Errors use `{ "error": { "code", "message", "requestId" } }`. Validation is `400`, unauthorized is `401`, forbidden is `403`, missing/hidden resources are `404`, stale state and duplicate operations are `409`, throttling is `429`, and unexpected errors are `500`.

## Routes

| Method and path                     | Access                                            | Purpose                                                                                                              |
| ----------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /health/live`                  | Public                                            | Process liveness.                                                                                                    |
| `GET /health/ready`                 | Public                                            | PostgreSQL readiness.                                                                                                |
| `POST /auth/register`               | Public, rate limited                              | Create a contributor or client account; passwords are scrypt-hashed.                                                 |
| `POST /auth/login`                  | Public, rate limited                              | Return a one-hour bearer token.                                                                                      |
| `GET /tasks`                        | Public                                            | Search published, unexpired tasks with bounded `search`, `page`, `limit`.                                            |
| `GET /tasks/:id`                    | Public for published tasks; owner for drafts      | Read task scope, criteria, budget, and deadline.                                                                     |
| `POST /tasks`                       | Client                                            | Create a draft with title, description, acceptance criteria, integer `budgetMinor`, `currency`, and ISO `deadline`.  |
| `PATCH /tasks/:id`                  | Owning client                                     | Edit a draft.                                                                                                        |
| `POST /tasks/:id/publish`           | Owning client                                     | Publish a draft with criteria and a future deadline.                                                                 |
| `POST /tasks/:id/close`             | Owning client                                     | Close a published task.                                                                                              |
| `POST /tasks/:id/claim`             | Contributor                                       | Create one assignment per contributor/task.                                                                          |
| `GET /assignments`                  | Contributor or client                             | List only the caller's assignments or owned-task assignments, with submission history.                               |
| `POST /assignments/:id/submissions` | Assigned contributor                              | Submit evidence, or submit a new version after a revision request (maximum three revisions).                         |
| `GET /submissions/:id`              | Contributor owner, task client, assigned reviewer | Read submission evidence and review history.                                                                         |
| `GET /reviews/queue`                | Assigned reviewer                                 | List assigned submissions awaiting review.                                                                           |
| `POST /reviews/assign`              | Admin                                             | Assign or reassign a submitted version to a reviewer.                                                                |
| `POST /reviews/:id/conflict`        | Assigned reviewer                                 | Declare a conflict and leave the review queue with a reason.                                                         |
| `POST /submissions/:id/review`      | Assigned reviewer or owning client                | Approve, reject, or request revision with an explanation. Approval creates one earning ledger entry transactionally. |
| `GET /earnings`                     | Contributor                                       | Read the caller's append-only earning and reversal history.                                                          |
| `POST /ledger/:id/reverse`          | Admin                                             | Append a reasoned, idempotent compensating reversal.                                                                 |
| `POST /ledger/:id/simulate-payment` | Admin, non-production only                        | Run a local simulated `paid` or `failed` outcome using an idempotency key.                                           |
| `GET /ledger/:id/payment-attempts`  | Contributor, owning client, support, admin        | Read simulated attempt history.                                                                                      |
| `POST /support/cases`               | Authenticated user                                | Open a case, optionally scoped to a task the user owns or is assigned to.                                            |
| `GET /support/cases`                | Authenticated user                                | List own cases; support/admin can list all.                                                                          |
| `GET /support/cases/:id/messages`   | Case owner, support, admin                        | Read case messages.                                                                                                  |
| `POST /support/cases/:id/messages`  | Case owner, support, admin                        | Add a message.                                                                                                       |
| `POST /support/cases/:id/resolve`   | Support or admin                                  | Resolve with an explanation and audit event.                                                                         |
| `POST /submissions/:id/appeals`     | Owning contributor                                | Appeal a rejection once, with an explanation.                                                                        |
| `GET /appeals`                      | Authenticated user                                | List own appeals; support/admin can list all.                                                                        |
| `POST /appeals/:id/resolve`         | Support or admin                                  | Uphold or overturn an appeal with an explanation. An overturned rejection returns to revision requested.             |
| `GET /notifications`                | Authenticated user                                | Read own in-app notifications.                                                                                       |
| `POST /notifications/:id/read`      | Notification owner                                | Mark one notification read.                                                                                          |
| `GET /dashboard`                    | Authenticated user                                | Return role-scoped persisted metrics.                                                                                |

## Financial semantics

Task budgets and ledger values use integer minor units and explicit currency. Approval creates an earning with a 10% platform fee rounded half-up to the nearest minor unit. A reversal is a new compensating entry; the original is retained. The local simulator records a separate payment attempt and provider-event record. It does not custody or transfer money. No external provider event webhook is configured.

## Limitations

The API is the only presentation layer today; a React dashboard and browser end-to-end workflow are not implemented. Reviewer assignment is administered explicitly; there is no automatic allocation. Support cases have no staff assignment, attachment storage, or measured response-time policy. Deployment authentication secrets, email delivery, provider integration, and a first-production-admin bootstrap process require operational design before production use.
