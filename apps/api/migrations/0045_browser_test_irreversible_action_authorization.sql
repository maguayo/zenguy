ALTER TABLE browser_tests ADD COLUMN test_data_attested INTEGER NOT NULL DEFAULT 0
  CHECK (test_data_attested IN (0, 1));

ALTER TABLE browser_tests ADD COLUMN irreversible_action_scopes_json TEXT NOT NULL DEFAULT '[]'
  CHECK (
    json_valid(irreversible_action_scopes_json)
    AND json_type(irreversible_action_scopes_json) = 'array'
    AND json_array_length(irreversible_action_scopes_json) <= 20
  );

-- The signed snapshot remains immutable. This separate, mutable ledger is
-- atomically decremented by the runner API before each irreversible effect.
ALTER TABLE test_runs ADD COLUMN action_authorizations_json TEXT NOT NULL DEFAULT '[]'
  CHECK (
    json_valid(action_authorizations_json)
    AND json_type(action_authorizations_json) = 'array'
    AND json_array_length(action_authorizations_json) <= 20
  );
