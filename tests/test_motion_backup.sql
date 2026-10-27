-- DEVELOPMENT DATABASE ONLY
-- Structural and access-control checks.

BEGIN;

DO $$
DECLARE
    trigger_count integer;
BEGIN
    SELECT COUNT(*)
    INTO trigger_count
    FROM pg_trigger
    WHERE tgrelid = 'public.motions'::regclass
      AND tgname = 'capture_motion_before_change_trigger'
      AND NOT tgisinternal;

    IF trigger_count <> 1 THEN
        RAISE EXCEPTION 'Backup trigger is not installed';
    END IF;

    IF has_table_privilege(
        'anon',
        'public.motion_change_backups',
        'SELECT'
    ) THEN
        RAISE EXCEPTION 'anon can read backups';
    END IF;

    IF has_table_privilege(
        'authenticated',
        'public.motion_change_backups',
        'SELECT'
    ) THEN
        RAISE EXCEPTION 'authenticated can read backups';
    END IF;
END $$;

ROLLBACK;
