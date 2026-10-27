-- DEVELOPMENT DATABASE ONLY.
-- Run after reviewing/applying the development migration; all test data rolls back.
BEGIN;

DO $$
DECLARE
  inserted jsonb;
  updated jsonb;
  deleted jsonb;
  restored jsonb;
  motion_key text;
  revision_before_failure integer;
  delete_audit_id bigint;
  audit_count bigint;
BEGIN
  inserted := public.motion_apply(
    'insert',
    NULL,
    jsonb_build_object(
      'motion', 'THW transactional audit test ' || txid_current()::text,
      'tournament', 'Local test',
      'year', '2099',
      'history', '[]'::jsonb
    ),
    NULL,
    'local-test'
  );
  motion_key := inserted ->> 'id';

  SELECT count(*) INTO audit_count
  FROM public.motion_audit
  WHERE motion_id::text = motion_key
    AND before_data IS NULL
    AND after_data ->> 'motion' = inserted ->> 'motion';
  IF audit_count <> 1 THEN
    RAISE EXCEPTION 'INSERT audit row is missing or duplicated';
  END IF;

  updated := public.motion_apply(
    'update', motion_key,
    jsonb_build_object(
      'motion', 'THW transactional audit updated ' || txid_current()::text,
      'tournament', 'Local test',
      'year', '2099',
      'history', '[]'::jsonb
    ),
    (inserted ->> 'revision')::integer,
    'local-test'
  );

  BEGIN
    PERFORM public.motion_apply(
      'update', motion_key,
      jsonb_build_object(
        'motion', 'stale revision',
        'tournament', 'Local test',
        'year', '2099',
        'history', '[]'::jsonb
      ),
      (inserted ->> 'revision')::integer,
      'local-test'
    );
    RAISE EXCEPTION 'Stale revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'REVISION_CONFLICT' THEN
      RAISE;
    END IF;
  END;

  deleted := public.motion_apply(
    'delete', motion_key, NULL,
    (updated ->> 'revision')::integer,
    'local-test'
  );
  IF (deleted ->> 'is_deleted')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Logical delete did not set is_deleted';
  END IF;

  SELECT audit_id INTO delete_audit_id
  FROM public.motion_audit
  WHERE motion_id::text = motion_key
    AND after_data ->> 'is_deleted' = 'true'
  ORDER BY audit_id DESC
  LIMIT 1;
  IF delete_audit_id IS NULL THEN
    RAISE EXCEPTION 'Logical delete audit row is missing';
  END IF;

  restored := public.motion_restore_revision_checked(
    motion_key, delete_audit_id, (deleted ->> 'revision')::integer
  );
  IF (restored ->> 'is_deleted')::boolean IS NOT FALSE
     OR restored ->> 'motion' <> updated ->> 'motion' THEN
    RAISE EXCEPTION 'Deleted motion restore failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.motion_audit
    WHERE motion_id::text = motion_key
      AND before_data ->> 'is_deleted' = 'true'
      AND after_data ->> 'is_deleted' = 'false'
      AND (after_data ->> 'revision')::integer = (restored ->> 'revision')::integer
  ) THEN
    RAISE EXCEPTION 'Restore operation was not audited';
  END IF;

  SELECT revision INTO revision_before_failure
  FROM public.motions
  WHERE id::text = motion_key;

  EXECUTE $create_function$
    CREATE FUNCTION pg_temp.fail_motion_audit_test()
    RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF current_setting('test.fail_motion_audit', true) = 'on' THEN
        RAISE EXCEPTION 'INJECTED_AUDIT_FAILURE';
      END IF;
      RETURN NEW;
    END;
    $body$
  $create_function$;
  CREATE TRIGGER fail_motion_audit_test
  BEFORE INSERT ON public.motion_audit
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_motion_audit_test();

  PERFORM set_config('test.fail_motion_audit', 'on', true);
  BEGIN
    PERFORM public.motion_apply(
      'update', motion_key,
      jsonb_build_object(
        'motion', 'must roll back',
        'tournament', 'Local test',
        'year', '2099',
        'history', '[]'::jsonb
      ),
      revision_before_failure,
      'local-test'
    );
    RAISE EXCEPTION 'Audit failure did not abort the write';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INJECTED_AUDIT_FAILURE' THEN
      RAISE;
    END IF;
  END;

  IF (SELECT revision FROM public.motions WHERE id::text = motion_key)
     <> revision_before_failure THEN
    RAISE EXCEPTION 'Motion changed despite audit failure';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.motion_restore_revision_checked(text,bigint,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.motion_restore_revision_checked(text,bigint,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Unauthenticated roles can execute restore RPC';
  END IF;
END;
$$;

ROLLBACK;
