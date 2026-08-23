-- Fence encrypted writes against the active workspace DEK in the same D1
-- statement. Existing v1-v3 rows remain readable for migration, but every new
-- or changed non-null encrypted field must carry the active v4 DEK. Without
-- this guard, an old Worker or a request paused under generation N could write
-- legacy/retired ciphertext after generation N+1 completed its final sweep.

CREATE TRIGGER trg_workspace_secrets_v4_insert_active_dek
BEFORE INSERT ON workspace_secrets
WHEN NEW.encryption_version <> 4
  OR substr(NEW.encrypted_value, 1, 3) <> 'v4:'
  OR NOT EXISTS (
    SELECT 1
    FROM workspace_data_encryption_keys k
    WHERE k.workspace_id = NEW.workspace_id
      AND k.active = 1
      AND substr(NEW.encrypted_value, 4, length(k.data_key_id)) = k.data_key_id
      AND substr(
        NEW.encrypted_value,
        4 + length(k.data_key_id),
        1
      ) = ':'
  )
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_STALE_DATA_ENCRYPTION_KEY');
END;

CREATE TRIGGER trg_workspace_secrets_v4_update_active_dek
BEFORE UPDATE OF id, workspace_id, encrypted_value, encryption_version
ON workspace_secrets
WHEN NEW.id IS NOT OLD.id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR (
    (
      NEW.encrypted_value IS NOT OLD.encrypted_value
      OR NEW.encryption_version IS NOT OLD.encryption_version
    )
    AND (
      NEW.encryption_version <> 4
      OR substr(NEW.encrypted_value, 1, 3) <> 'v4:'
      OR NOT EXISTS (
    SELECT 1
    FROM workspace_data_encryption_keys k
    WHERE k.workspace_id = NEW.workspace_id
      AND k.active = 1
      AND substr(NEW.encrypted_value, 4, length(k.data_key_id)) = k.data_key_id
      AND substr(
        NEW.encrypted_value,
        4 + length(k.data_key_id),
        1
      ) = ':'
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_STALE_DATA_ENCRYPTION_KEY');
END;

CREATE TRIGGER trg_notification_channels_v4_insert_active_dek
BEFORE INSERT ON notification_channels
WHEN substr(NEW.encrypted_config, 1, 3) <> 'v4:'
  OR NOT EXISTS (
    SELECT 1
    FROM workspace_data_encryption_keys k
    WHERE k.workspace_id = NEW.workspace_id
      AND k.active = 1
      AND substr(NEW.encrypted_config, 4, length(k.data_key_id)) = k.data_key_id
      AND substr(
        NEW.encrypted_config,
        4 + length(k.data_key_id),
        1
      ) = ':'
  )
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_STALE_DATA_ENCRYPTION_KEY');
END;

CREATE TRIGGER trg_notification_channels_v4_update_active_dek
BEFORE UPDATE OF id, workspace_id, encrypted_config ON notification_channels
WHEN NEW.id IS NOT OLD.id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR (
    NEW.encrypted_config IS NOT OLD.encrypted_config
    AND (
      substr(NEW.encrypted_config, 1, 3) <> 'v4:'
      OR NOT EXISTS (
    SELECT 1
    FROM workspace_data_encryption_keys k
    WHERE k.workspace_id = NEW.workspace_id
      AND k.active = 1
      AND substr(NEW.encrypted_config, 4, length(k.data_key_id)) = k.data_key_id
      AND substr(
        NEW.encrypted_config,
        4 + length(k.data_key_id),
        1
      ) = ':'
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_STALE_DATA_ENCRYPTION_KEY');
END;

CREATE TRIGGER trg_uptime_monitors_v4_headers_insert_active_dek
BEFORE INSERT ON uptime_monitors
WHEN NEW.encrypted_headers IS NOT NULL
  AND (
    substr(NEW.encrypted_headers, 1, 3) <> 'v4:'
    OR NOT EXISTS (
    SELECT 1
    FROM workspace_data_encryption_keys k
    WHERE k.workspace_id = NEW.workspace_id
      AND k.active = 1
      AND substr(NEW.encrypted_headers, 4, length(k.data_key_id)) = k.data_key_id
      AND substr(
        NEW.encrypted_headers,
        4 + length(k.data_key_id),
        1
      ) = ':'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_STALE_DATA_ENCRYPTION_KEY');
END;

CREATE TRIGGER trg_uptime_monitors_v4_headers_update_active_dek
BEFORE UPDATE OF id, workspace_id, encrypted_headers ON uptime_monitors
WHEN NEW.id IS NOT OLD.id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR (
    NEW.encrypted_headers IS NOT OLD.encrypted_headers
    AND NEW.encrypted_headers IS NOT NULL
    AND (
      substr(NEW.encrypted_headers, 1, 3) <> 'v4:'
      OR NOT EXISTS (
    SELECT 1
    FROM workspace_data_encryption_keys k
    WHERE k.workspace_id = NEW.workspace_id
      AND k.active = 1
      AND substr(NEW.encrypted_headers, 4, length(k.data_key_id)) = k.data_key_id
      AND substr(
        NEW.encrypted_headers,
        4 + length(k.data_key_id),
        1
      ) = ':'
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_STALE_DATA_ENCRYPTION_KEY');
END;

CREATE TRIGGER trg_uptime_monitors_v4_body_insert_active_dek
BEFORE INSERT ON uptime_monitors
WHEN NEW.encrypted_body IS NOT NULL
  AND (
    substr(NEW.encrypted_body, 1, 3) <> 'v4:'
    OR NOT EXISTS (
    SELECT 1
    FROM workspace_data_encryption_keys k
    WHERE k.workspace_id = NEW.workspace_id
      AND k.active = 1
      AND substr(NEW.encrypted_body, 4, length(k.data_key_id)) = k.data_key_id
      AND substr(
        NEW.encrypted_body,
        4 + length(k.data_key_id),
        1
      ) = ':'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_STALE_DATA_ENCRYPTION_KEY');
END;

CREATE TRIGGER trg_uptime_monitors_v4_body_update_active_dek
BEFORE UPDATE OF id, workspace_id, encrypted_body ON uptime_monitors
WHEN NEW.id IS NOT OLD.id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR (
    NEW.encrypted_body IS NOT OLD.encrypted_body
    AND NEW.encrypted_body IS NOT NULL
    AND (
      substr(NEW.encrypted_body, 1, 3) <> 'v4:'
      OR NOT EXISTS (
    SELECT 1
    FROM workspace_data_encryption_keys k
    WHERE k.workspace_id = NEW.workspace_id
      AND k.active = 1
      AND substr(NEW.encrypted_body, 4, length(k.data_key_id)) = k.data_key_id
      AND substr(
        NEW.encrypted_body,
        4 + length(k.data_key_id),
        1
      ) = ':'
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_STALE_DATA_ENCRYPTION_KEY');
END;
