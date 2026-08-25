-- Runner en Cloudflare Containers (CLOUDFLARE_RUNNER.md): tercer modo 'cf'.
-- SQLite no permite ampliar un CHECK inline, así que se usa add-copy-swap
-- para conservar los valores históricos de atribución.

ALTER TABLE test_attempts ADD COLUMN runner_kind_v2 TEXT CHECK (runner_kind_v2 IN ('primary','fallback','cf'));
UPDATE test_attempts SET runner_kind_v2 = runner_kind;
ALTER TABLE test_attempts DROP COLUMN runner_kind;
ALTER TABLE test_attempts RENAME COLUMN runner_kind_v2 TO runner_kind;

ALTER TABLE runner_workers ADD COLUMN mode_v2 TEXT NOT NULL DEFAULT 'local' CHECK (mode_v2 IN ('local','fallback','cf'));
UPDATE runner_workers SET mode_v2 = mode;
ALTER TABLE runner_workers DROP COLUMN mode;
ALTER TABLE runner_workers RENAME COLUMN mode_v2 TO mode;
