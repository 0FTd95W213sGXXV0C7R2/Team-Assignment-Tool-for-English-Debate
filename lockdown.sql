
-- STAGE 2: RUN ONLY AFTER the new Worker has been deployed and tested.
-- This replaces existing policies on public.motions.
-- Confirm no other application depends on them.
-- Until this runs, anonymous users can bypass the Worker
-- and write directly to Supabase.

BEGIN;

ALTER TABLE public.motions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'motions'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.motions',
      p.policyname
    );
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.motions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.motions TO anon, authenticated;

CREATE POLICY motions_public_read_active
ON public.motions
FOR SELECT TO anon, authenticated
USING (is_deleted = false);

COMMIT;
