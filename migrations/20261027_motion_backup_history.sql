-- DEVELOPMENT ONLY
-- Privileged history inspection view.

BEGIN;

CREATE OR REPLACE VIEW public.motion_change_backup_history
WITH (security_invoker = true)
AS
SELECT
    id,
    motion_id,
    operation,
    backed_up_at,
    transaction_id,
    previous_row
FROM public.motion_change_backups;

REVOKE ALL ON public.motion_change_backup_history
FROM PUBLIC, anon, authenticated;

COMMIT;
