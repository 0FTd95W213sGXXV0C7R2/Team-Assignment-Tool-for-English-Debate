-- Development migration. Review the existing motion_audit schema before applying.
-- Do not apply to production without a separate deployment review.
BEGIN;

CREATE TABLE IF NOT EXISTS public.motion_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  motion_id text NOT NULL,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.motions
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

-- Keep the old table as history, but stop duplicating rows already covered by
-- motion_audit or the RPC fallback.
DROP TRIGGER IF EXISTS capture_motion_before_change_trigger ON public.motions;

DO $$
DECLARE
  missing_columns text[];
BEGIN
  SELECT array_agg(required.column_name)
  INTO missing_columns
  FROM (VALUES
    ('audit_id'),
    ('motion_id'),
    ('action'),
    ('before_data'),
    ('after_data'),
    ('changed_at')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'motion_audit'
      AND column_info.column_name = required.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'motion_audit is missing required columns: %', missing_columns;
  END IF;

  SELECT array_agg(required.column_name)
  INTO missing_columns
  FROM (VALUES
    ('id'),
    ('motion'),
    ('tournament'),
    ('year'),
    ('history'),
    ('revision'),
    ('is_deleted')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'motions'
      AND column_info.column_name = required.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'motions is missing required columns: %', missing_columns;
  END IF;
END;
$$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.motion_audit
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.motion_audit TO service_role;

CREATE OR REPLACE FUNCTION public.motion_audit_trigger_present(p_operation text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    JOIN pg_catalog.pg_proc trigger_function
      ON trigger_function.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'public.motions'::regclass
      AND NOT trigger_row.tgisinternal
      AND trigger_function.prosrc ILIKE '%motion_audit%'
      AND CASE p_operation
        WHEN 'INSERT' THEN (trigger_row.tgtype & 4) = 4
        WHEN 'UPDATE' THEN (trigger_row.tgtype & 16) = 16
        WHEN 'DELETE' THEN (trigger_row.tgtype & 8) = 8
        ELSE false
      END
  )
$$;

CREATE OR REPLACE FUNCTION public.motion_apply(
  p_action text,
  p_id text,
  p_row jsonb,
  p_expected_revision integer,
  p_client_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_row public.motions%ROWTYPE;
  updated_row public.motions%ROWTYPE;
  next_history jsonb;
  next_image jsonb;
  motion_text text;
  tournament_text text;
  year_text text;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('insert', 'update', 'delete', 'record') THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  IF p_action IN ('insert', 'update') THEN
    IF p_row IS NULL OR jsonb_typeof(p_row) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;
    IF NOT (p_row ? 'motion') OR NOT (p_row ? 'tournament')
       OR NOT (p_row ? 'year') OR NOT (p_row ? 'history')
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(p_row) AS supplied(key)
         WHERE supplied.key NOT IN ('motion', 'tournament', 'year', 'history')
       )
       OR jsonb_typeof(p_row -> 'motion') <> 'string'
       OR jsonb_typeof(p_row -> 'tournament') <> 'string'
       OR jsonb_typeof(p_row -> 'year') <> 'string' THEN
      RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;

    motion_text := btrim(p_row ->> 'motion');
    tournament_text := coalesce(p_row ->> 'tournament', '');
    year_text := coalesce(p_row ->> 'year', '');
    IF motion_text IS NULL OR motion_text = '' OR length(motion_text) > 2000
       OR length(tournament_text) > 300 OR length(year_text) > 20 THEN
      RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;
    IF jsonb_typeof(p_row -> 'history') <> 'array' THEN
      RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;
    IF jsonb_array_length(p_row -> 'history') > 1000 THEN
      RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;
  END IF;

  IF p_action = 'insert' THEN
    IF p_id IS NOT NULL OR p_expected_revision IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        lower(motion_text) || chr(31) ||
        lower(tournament_text) || chr(31) || lower(year_text),
        0
      )
    );

    IF EXISTS (
      SELECT 1
      FROM public.motions existing
      WHERE coalesce(existing.is_deleted, false) = false
        AND lower(btrim(existing.motion)) = lower(motion_text)
        AND lower(btrim(coalesce(existing.tournament, ''))) = lower(tournament_text)
        AND lower(btrim(coalesce(existing.year::text, ''))) = lower(year_text)
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_MOTION';
    END IF;

    INSERT INTO public.motions (
      motion, tournament, year, history, revision, is_deleted
    )
    SELECT prepared.motion, prepared.tournament, prepared.year,
      prepared.history, 0, false
    FROM jsonb_populate_record(
      NULL::public.motions,
      jsonb_build_object(
        'motion', motion_text,
        'tournament', tournament_text,
        'year', year_text,
        'history', coalesce(p_row -> 'history', '[]'::jsonb)
      )
    ) AS prepared
    RETURNING * INTO updated_row;

    IF NOT public.motion_audit_trigger_present('INSERT') THEN
      INSERT INTO public.motion_audit (
        motion_id, action, before_data, after_data
      )
      VALUES (
        updated_row.id, 'INSERT', NULL, to_jsonb(updated_row)
      );
    END IF;

    RETURN to_jsonb(updated_row);
  END IF;

  IF p_id IS NULL OR p_id = '' OR length(p_id) > 100
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  SELECT *
  INTO current_row
  FROM public.motions
  WHERE id::text = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF coalesce(current_row.revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'REVISION_CONFLICT';
  END IF;
  IF coalesce(current_row.is_deleted, false) THEN
    RAISE EXCEPTION 'DELETED';
  END IF;

  IF p_action = 'update' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        lower(motion_text) || chr(31) ||
        lower(tournament_text) || chr(31) || lower(year_text),
        0
      )
    );
    IF EXISTS (
      SELECT 1
      FROM public.motions existing
      WHERE existing.id::text <> p_id
        AND coalesce(existing.is_deleted, false) = false
        AND lower(btrim(existing.motion)) = lower(motion_text)
        AND lower(btrim(coalesce(existing.tournament, ''))) = lower(tournament_text)
        AND lower(btrim(coalesce(existing.year::text, ''))) = lower(year_text)
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_MOTION';
    END IF;
  END IF;

  IF p_action = 'record' THEN
    next_history := coalesce(current_row.history, '[]'::jsonb)
      || jsonb_build_array(clock_timestamp()::text);
    next_image := to_jsonb(current_row) || jsonb_build_object(
      'history', next_history,
      'revision', coalesce(current_row.revision, 0) + 1
    );
  ELSIF p_action = 'delete' THEN
    next_image := to_jsonb(current_row) || jsonb_build_object(
      'is_deleted', true,
      'revision', coalesce(current_row.revision, 0) + 1
    );
  ELSE
    next_image := to_jsonb(current_row) || jsonb_build_object(
      'motion', motion_text,
      'tournament', tournament_text,
      'year', year_text,
      'history', coalesce(p_row -> 'history', current_row.history),
      'revision', coalesce(current_row.revision, 0) + 1
    );
  END IF;

  IF NOT public.motion_audit_trigger_present('UPDATE') THEN
    INSERT INTO public.motion_audit (
      motion_id, action, before_data, after_data
    )
    VALUES (
      current_row.id,
      'UPDATE',
      to_jsonb(current_row),
      next_image
    );
  END IF;

  UPDATE public.motions
  SET motion = prepared.motion,
      tournament = prepared.tournament,
      year = prepared.year,
      history = prepared.history,
      revision = prepared.revision,
      is_deleted = prepared.is_deleted
  FROM jsonb_populate_record(NULL::public.motions, next_image) AS prepared
  WHERE public.motions.id::text = p_id
  RETURNING public.motions.* INTO updated_row;

  RETURN to_jsonb(updated_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.motion_restore_revision_checked(
  p_id text,
  p_audit_id bigint,
  p_expected_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_row public.motions%ROWTYPE;
  snapshot jsonb;
  next_image jsonb;
  restored_row public.motions%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_id = '' OR length(p_id) > 100
     OR p_audit_id IS NULL OR p_audit_id <= 0
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  SELECT *
  INTO current_row
  FROM public.motions
  WHERE id::text = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF coalesce(current_row.revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'REVISION_CONFLICT';
  END IF;

  SELECT before_data
  INTO snapshot
  FROM public.motion_audit
  WHERE audit_id = p_audit_id
    AND motion_id::text = p_id;

  IF NOT FOUND OR snapshot IS NULL THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_FOUND';
  END IF;
  IF snapshot ->> 'motion' IS NULL OR snapshot ->> 'motion' = '' THEN
    RAISE EXCEPTION 'INVALID_SNAPSHOT';
  END IF;

  IF coalesce((snapshot ->> 'is_deleted')::boolean, false) = false THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        lower(btrim(snapshot ->> 'motion')) || chr(31) ||
        lower(btrim(coalesce(snapshot ->> 'tournament', ''))) || chr(31) ||
        lower(btrim(coalesce(snapshot ->> 'year', ''))),
        0
      )
    );
    IF EXISTS (
      SELECT 1
      FROM public.motions existing
      WHERE existing.id::text <> p_id
        AND coalesce(existing.is_deleted, false) = false
        AND lower(btrim(existing.motion)) = lower(btrim(snapshot ->> 'motion'))
        AND lower(btrim(coalesce(existing.tournament, ''))) =
          lower(btrim(coalesce(snapshot ->> 'tournament', '')))
        AND lower(btrim(coalesce(existing.year::text, ''))) =
          lower(btrim(coalesce(snapshot ->> 'year', '')))
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_MOTION';
    END IF;
  END IF;

  next_image := to_jsonb(current_row) || jsonb_build_object(
    'motion', snapshot ->> 'motion',
    'tournament', coalesce(snapshot ->> 'tournament', ''),
    'year', coalesce(snapshot ->> 'year', ''),
    'history', coalesce(snapshot -> 'history', '[]'::jsonb),
    'is_deleted', coalesce((snapshot ->> 'is_deleted')::boolean, false),
    'revision', coalesce(current_row.revision, 0) + 1
  );

  IF NOT public.motion_audit_trigger_present('UPDATE') THEN
    INSERT INTO public.motion_audit (
      motion_id, action, before_data, after_data
    )
    VALUES (
      current_row.id, 'UPDATE', to_jsonb(current_row), next_image
    );
  END IF;

  UPDATE public.motions
  SET motion = prepared.motion,
      tournament = prepared.tournament,
      year = prepared.year,
      history = prepared.history,
      revision = prepared.revision,
      is_deleted = prepared.is_deleted
  FROM jsonb_populate_record(NULL::public.motions, next_image) AS prepared
  WHERE public.motions.id::text = p_id
  RETURNING public.motions.* INTO restored_row;

  RETURN to_jsonb(restored_row);
END;
$$;

REVOKE ALL ON FUNCTION public.motion_apply(text, text, jsonb, integer, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.motion_restore_revision_checked(text, bigint, integer)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.motion_audit_trigger_present(text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.motion_apply(text, text, jsonb, integer, text)
TO service_role;
GRANT EXECUTE ON FUNCTION public.motion_restore_revision_checked(text, bigint, integer)
TO service_role;

COMMIT;
