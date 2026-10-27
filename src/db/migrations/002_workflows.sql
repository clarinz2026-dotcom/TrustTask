CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  contributor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'rejected', 'cancelled')) DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, contributor_id)
);
CREATE INDEX assignments_contributor_idx ON assignments (contributor_id, status, created_at DESC);

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  evidence TEXT NOT NULL CHECK (char_length(evidence) BETWEEN 10 AND 10000),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'in_review', 'revision_requested', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, version)
);
CREATE INDEX submissions_review_idx ON submissions (status, created_at);
CREATE INDEX submissions_assignment_idx ON submissions (assignment_id, version DESC);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'request_revision', 'reject')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id)
);

CREATE TABLE review_assignments (
  submission_id UUID PRIMARY KEY REFERENCES submissions(id) ON DELETE RESTRICT,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  conflicted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX review_queue_idx ON review_assignments (reviewer_id, conflicted_at, created_at DESC);

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('earning', 'reversal')) DEFAULT 'earning',
  contributor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  reverses_entry_id UUID REFERENCES ledger_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  gross_minor BIGINT NOT NULL CHECK (gross_minor > 0),
  fee_minor BIGINT NOT NULL CHECK (fee_minor >= 0 AND fee_minor <= gross_minor),
  net_minor BIGINT NOT NULL CHECK (net_minor = gross_minor - fee_minor),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved', 'processing', 'paid', 'failed', 'disputed', 'reversed')) DEFAULT 'approved',
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((entry_type='earning' AND reverses_entry_id IS NULL) OR (entry_type='reversal' AND reverses_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX ledger_one_earning_per_submission ON ledger_entries (submission_id) WHERE entry_type='earning';
CREATE INDEX ledger_contributor_idx ON ledger_entries (contributor_id, created_at DESC);

CREATE FUNCTION deny_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are append-only';
END;
$$;
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();

CREATE TABLE payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_entry_id UUID NOT NULL REFERENCES ledger_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('local-simulator')),
  provider_reference TEXT NOT NULL UNIQUE,
  requested_outcome TEXT NOT NULL CHECK (requested_outcome IN ('paid', 'failed')),
  status TEXT NOT NULL CHECK (status IN ('processing', 'paid', 'failed')),
  failure_reason TEXT,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_attempt_ledger_idx ON payment_attempts (ledger_entry_id, created_at DESC);

CREATE TABLE payment_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id UUID NOT NULL REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  provider_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN ('task', 'payment', 'account', 'other')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')) DEFAULT 'normal',
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved', 'appealed')) DEFAULT 'open',
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 5 AND 180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_owner_idx ON support_cases (owner_id, status, created_at DESC);

CREATE TABLE case_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES support_cases(id) ON DELETE RESTRICT,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  appellant_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 4000),
  status TEXT NOT NULL CHECK (status IN ('open', 'upheld', 'overturned')) DEFAULT 'open',
  resolution TEXT,
  resolver_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (submission_id)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON notifications (user_id, created_at DESC);
