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

    IF trigger_count <> 0 THEN
        RAISE EXCEPTION 'Legacy duplicate backup trigger is still installed';
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

    IF to_regprocedure(
        'public.motion_apply(text,text,jsonb,integer,text)'
    ) IS NULL THEN
        RAISE EXCEPTION 'Transactional motion RPC is missing';
    END IF;

    IF to_regprocedure(
        'public.motion_restore_revision_checked(text,bigint,integer)'
    ) IS NULL THEN
        RAISE EXCEPTION 'Transactional restore RPC is missing';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.motion_apply(text,text,jsonb,integer,text)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.motion_apply(text,text,jsonb,integer,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Unprivileged roles can execute the write RPC';
    END IF;

    IF has_table_privilege('anon', 'public.motion_audit', 'INSERT')
       OR has_table_privilege('authenticated', 'public.motion_audit', 'INSERT')
       OR has_table_privilege('anon', 'public.motion_audit', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.motion_audit', 'DELETE') THEN
        RAISE EXCEPTION 'Unprivileged role can modify the audit history';
    END IF;
END $$;

ROLLBACK;
