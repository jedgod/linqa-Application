-- Internal notes for the case workspace (clients/web
-- admin/pages/OperationsConsolePage.tsx case detail view). Deferred out of
-- 028_repo_native_operations.sql on purpose until there was an actual
-- reader/writer for it -- see server/src/routes/operations/index.ts
-- POST /v1/admin/operations/cases/:caseId/notes.

CREATE TABLE IF NOT EXISTS ops_case_internal_notes_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES support_cases_v2(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_case_internal_notes_v2_case
  ON ops_case_internal_notes_v2(case_id, created_at);
