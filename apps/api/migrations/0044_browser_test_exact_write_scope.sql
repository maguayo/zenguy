ALTER TABLE browser_tests
  ADD COLUMN writable_domains_json TEXT NOT NULL DEFAULT '[]'
  CHECK (
    json_valid(writable_domains_json)
    AND json_type(writable_domains_json) = 'array'
    AND json_array_length(writable_domains_json) <= 20
  );

-- Version 1's global flag is intentionally retired. Existing tests become
-- read-only until an owner/admin reviews and saves exact writable hosts.
UPDATE browser_tests SET allow_reversible_writes = 0;
