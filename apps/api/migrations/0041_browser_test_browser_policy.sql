ALTER TABLE browser_tests
  ADD COLUMN allowed_domains_json TEXT NOT NULL DEFAULT '[]'
  CHECK (
    json_valid(allowed_domains_json)
    AND json_type(allowed_domains_json) = 'array'
    AND json_array_length(allowed_domains_json) <= 20
  );

ALTER TABLE browser_tests
  ADD COLUMN allow_reversible_writes INTEGER NOT NULL DEFAULT 0
  CHECK (allow_reversible_writes IN (0, 1));
