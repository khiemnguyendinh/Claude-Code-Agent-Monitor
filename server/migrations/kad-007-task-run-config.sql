-- kad-007-task-run-config.sql
-- Per-task run configuration chosen in the "Giao việc" composer (Claude-Desktop
-- style): which model, how much thinking (effort), and the permission mode the
-- spawned `claude` turn should use. All nullable → NULL means "inherit default"
-- (model: engine default; thinking_level: model default; permission_mode falls
-- back to 'acceptEdits' at spawn time). Migration-safe: additive columns only.
ALTER TABLE tasks ADD COLUMN model TEXT;
ALTER TABLE tasks ADD COLUMN thinking_level TEXT;
ALTER TABLE tasks ADD COLUMN permission_mode TEXT;
