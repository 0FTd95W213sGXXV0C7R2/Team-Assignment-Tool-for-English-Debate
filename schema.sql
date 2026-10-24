
-- STAGE 1: Run in Supabase SQL Editor ONLY after saving a current motions.json backup.
-- This script is additive: it does not remove existing anonymous write policies.
-- The existing 926 rows and their IDs are not replaced or re-imported.
BEGIN;

ALTER TABLE public.motions ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.motions ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.motion_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  motion_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  before_data jsonb,
  after_data jsonb,
  actor text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.motion_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.motion_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.motion_audit_audit_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_motion_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor text := nullif(current_setting('app.motion_actor', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.motion_audit(motion_id,action,after_data,actor)
      VALUES (NEW.id,'INSERT',to_jsonb(NEW),v_actor);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.motion_audit(motion_id,action,before_data,after_data,actor)
      VALUES (OLD.id,'UPDATE',to_jsonb(OLD),to_jsonb(NEW),v_actor);
    RETURN NEW;
  ELSE
    INSERT INTO public.motion_audit(motion_id,action,before_data,actor)
      VALUES (OLD.id,'DELETE',to_jsonb(OLD),v_actor);
    RETURN OLD;
  END IF;
END $$;

DROP TRIGGER IF EXISTS motions_audit_trigger ON public.motions;
CREATE TRIGGER motions_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.motions
  FOR EACH ROW EXECUTE FUNCTION public.log_motion_change();

CREATE TABLE IF NOT EXISTS public.motion_write_limits (
  client_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  action text NOT NULL,
  writes integer NOT NULL DEFAULT 0,
  PRIMARY KEY(client_hash,window_start,action)
);
ALTER TABLE public.motion_write_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.motion_write_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.motion_apply(
  p_action text,
  p_id text DEFAULT NULL,
  p_row jsonb DEFAULT NULL,
  p_expected_revision bigint DEFAULT NULL,
  p_client_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_current public.motions%ROWTYPE;
  v_id text;
  v_revision bigint;
  v_count integer;
  v_motion text;
  v_tournament text;
  v_year text;
  v_history jsonb;
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now());
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('insert','update','delete','record') THEN
    RAISE EXCEPTION 'INVALID_ACTION';
  END IF;
  IF p_client_hash IS NULL OR p_client_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_CLIENT';
  END IF;

  -- Serialize small-volume club edits.
  -- Prevents concurrent duplicate inserts and lost updates.
  PERFORM pg_advisory_xact_lock(20261024);

  IF p_action <> 'insert' THEN
    IF p_id IS NULL OR length(p_id) > 100 OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
      RAISE EXCEPTION 'INVALID_TARGET';
    END IF;
    SELECT * INTO v_current FROM public.motions WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF v_current.is_deleted THEN RAISE EXCEPTION 'DELETED'; END IF;
    IF v_current.revision <> p_expected_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
  END IF;

  IF p_action IN ('insert','update') THEN
    IF jsonb_typeof(p_row) <> 'object' THEN RAISE EXCEPTION 'INVALID_ROW'; END IF;
    v_motion := btrim(p_row->>'motion');
    v_tournament := btrim(p_row->>'tournament');
    v_year := COALESCE(btrim(p_row->>'year'),'');
    v_history := p_row->'history';

    IF v_motion IS NULL OR length(v_motion) NOT BETWEEN 1 AND 1500
       OR v_tournament IS NULL OR length(v_tournament) NOT BETWEEN 1 AND 180
       OR length(v_year)>40 OR jsonb_typeof(v_history)<>'array'
       OR jsonb_array_length(v_history)>500 THEN
      RAISE EXCEPTION 'INVALID_ROW';
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_history) h
      WHERE jsonb_typeof(h.value)<>'string' OR length(h.value #>> '{}')>40
    ) THEN RAISE EXCEPTION 'INVALID_HISTORY'; END IF;

    IF EXISTS (
      SELECT 1 FROM public.motions m
      WHERE NOT m.is_deleted AND m.id IS DISTINCT FROM p_id
        AND lower(btrim(m.motion))=lower(v_motion)
        AND lower(btrim(m.tournament))=lower(v_tournament)
        AND lower(btrim(COALESCE(m.year,'')))=lower(v_year)
    ) THEN RAISE EXCEPTION 'DUPLICATE_MOTION'; END IF;
  END IF;

  -- Per-IP: 20 writes/hour; 3 soft-deletes/hour.
  INSERT INTO public.motion_write_limits(client_hash,window_start,action,writes)
    VALUES(p_client_hash,v_hour,'all',1)
    ON CONFLICT(client_hash,window_start,action)
    DO UPDATE SET writes=public.motion_write_limits.writes+1 RETURNING writes INTO v_count;
  IF v_count>20 THEN RAISE EXCEPTION 'RATE_LIMIT_IP'; END IF;

  IF p_action='delete' THEN
    INSERT INTO public.motion_write_limits(client_hash,window_start,action,writes)
      VALUES(p_client_hash,v_hour,'delete',1)
      ON CONFLICT(client_hash,window_start,action)
      DO UPDATE SET writes=public.motion_write_limits.writes+1 RETURNING writes INTO v_count;
    IF v_count>3 THEN RAISE EXCEPTION 'RATE_LIMIT_DELETE_IP'; END IF;
  END IF;

  -- Global circuit breaker:
  -- no more than 80 public writes/day or 10 deletes/day.
  INSERT INTO public.motion_write_limits(client_hash,window_start,action,writes)
    VALUES('__global__',v_day,'all',1)
    ON CONFLICT(client_hash,window_start,action)
    DO UPDATE SET writes=public.motion_write_limits.writes+1 RETURNING writes INTO v_count;
  IF v_count>80 THEN RAISE EXCEPTION 'RATE_LIMIT_GLOBAL'; END IF;

  IF p_action='delete' THEN
    INSERT INTO public.motion_write_limits(client_hash,window_start,action,writes)
      VALUES('__global__',v_day,'delete',1)
      ON CONFLICT(client_hash,window_start,action)
      DO UPDATE SET writes=public.motion_write_limits.writes+1 RETURNING writes INTO v_count;
    IF v_count>10 THEN RAISE EXCEPTION 'RATE_LIMIT_DELETE_GLOBAL'; END IF;
  END IF;

  PERFORM set_config('app.motion_actor', p_client_hash, true);

  IF p_action='insert' THEN
    v_id := gen_random_uuid()::text;
    INSERT INTO public.motions(id,motion,tournament,year,history,is_deleted,revision)
      VALUES(v_id,v_motion,v_tournament,v_year,v_history,false,0);
    v_revision := 0;

  ELSIF p_action='update' THEN
    UPDATE public.motions SET motion=v_motion,tournament=v_tournament,year=v_year,
      history=v_history,revision=revision+1 WHERE id=p_id RETURNING revision INTO v_revision;
    v_id := p_id;

  ELSIF p_action='record' THEN
    IF jsonb_array_length(COALESCE(v_current.history,'[]'::jsonb))>=500 THEN
      RAISE EXCEPTION 'INVALID_HISTORY_LIMIT';
    END IF;
    UPDATE public.motions SET
      history=COALESCE(history,'[]'::jsonb) ||
        to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      revision=revision+1 WHERE id=p_id RETURNING revision INTO v_revision;
    v_id := p_id;

  ELSE
    UPDATE public.motions SET is_deleted=true,revision=revision+1
      WHERE id=p_id RETURNING revision INTO v_revision;
    v_id := p_id;
  END IF;

  RETURN jsonb_build_object('id',v_id,'revision',v_revision);
END $$;

REVOKE ALL ON FUNCTION public.motion_apply(text,text,jsonb,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.motion_apply(text,text,jsonb,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.motion_admin_restore(p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_revision bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(20261024);
  PERFORM set_config('app.motion_actor','admin',true);
  UPDATE public.motions SET is_deleted=false,revision=revision+1
    WHERE id=p_id AND is_deleted=true RETURNING revision INTO v_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object('id',p_id,'revision',v_revision);
END $$;

REVOKE ALL ON FUNCTION public.motion_admin_restore(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.motion_admin_restore(text) TO service_role;

-- Full snapshot restore runs in one transaction.
-- It restores motions, not the audit log.
-- Audit entries for the restore are appended instead.
CREATE OR REPLACE FUNCTION public.motion_restore_snapshot(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 50000 THEN
    RAISE EXCEPTION 'INVALID_SNAPSHOT';
  END IF;

  SELECT count(*) INTO v_count FROM jsonb_to_recordset(p_rows)
    AS x(id text,motion text,tournament text,year text,history jsonb,is_deleted boolean,revision bigint)
    WHERE id IS NULL OR length(id)>100 OR motion IS NULL OR tournament IS NULL
       OR jsonb_typeof(history)<>'array' OR jsonb_array_length(history)>500;
  IF v_count>0 THEN RAISE EXCEPTION 'INVALID_SNAPSHOT_ROWS'; END IF;

  SELECT count(*) INTO v_count FROM (
    SELECT id FROM jsonb_to_recordset(p_rows) AS x(id text) GROUP BY id HAVING count(*)>1
  ) duplicates;
  IF v_count>0 THEN RAISE EXCEPTION 'INVALID_DUPLICATE_IDS'; END IF;

  PERFORM pg_advisory_xact_lock(20261024);
  PERFORM set_config('app.motion_actor','admin-full-restore',true);

  INSERT INTO public.motions(id,motion,tournament,year,history,is_deleted,revision)
  SELECT x.id,x.motion,x.tournament,x.year,x.history,COALESCE(x.is_deleted,false),COALESCE(x.revision,0)+1
  FROM jsonb_to_recordset(p_rows)
    AS x(id text,motion text,tournament text,year text,history jsonb,is_deleted boolean,revision bigint)
  ON CONFLICT(id) DO UPDATE SET
    motion=EXCLUDED.motion,tournament=EXCLUDED.tournament,year=EXCLUDED.year,
    history=EXCLUDED.history,is_deleted=EXCLUDED.is_deleted,
    revision=GREATEST(motions.revision,EXCLUDED.revision)+1;

  DELETE FROM public.motions WHERE id NOT IN (
    SELECT id FROM jsonb_to_recordset(p_rows) AS x(id text)
  );

  RETURN jsonb_array_length(p_rows);
END $$;

REVOKE ALL ON FUNCTION public.motion_restore_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.motion_restore_snapshot(jsonb) TO service_role;

COMMIT;
