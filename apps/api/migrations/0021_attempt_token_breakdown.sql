-- Per-attempt LLM cost breakdown (prompt vs completion tokens; token_usage
-- keeps the total) and which runner executed the attempt: the primary
-- queue-driven worker or the plan-B fallback runner.
ALTER TABLE test_attempts ADD COLUMN input_tokens INTEGER;
ALTER TABLE test_attempts ADD COLUMN output_tokens INTEGER;
ALTER TABLE test_attempts ADD COLUMN runner_kind TEXT CHECK (runner_kind IN ('primary','fallback'));
