-- A workspace can delegate many ADMIN roles, but authority has exactly one
-- canonical OWNER. TransferOwnership demotes before promoting inside one D1
-- batch so this partial unique index is never transiently violated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_single_owner
ON workspace_members(workspace_id)
WHERE role = 'OWNER';
