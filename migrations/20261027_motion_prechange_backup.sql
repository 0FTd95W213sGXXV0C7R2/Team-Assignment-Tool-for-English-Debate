-- Development migration only: DO NOT apply to production without review.
-- Capture OLD motions before UPDATE/DELETE in the same transaction.
BEGIN;
CREATE TABLE IF NOT EXISTS public.motion_change_backups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  motion_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  previous_row jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  transaction_id bigint NOT NULL DEFAULT txid_current()
);
REVOKE ALL ON public.motion_change_backups FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.capture_motion_before_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.motion_change_backups(motion_id, operation, previous_row)
  VALUES (OLD.id::text, TG_OP, to_jsonb(OLD));
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_motion_before_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS capture_motion_before_change_trigger ON public.motions;
CREATE TRIGGER capture_motion_before_change_trigger
BEFORE UPDATE OR DELETE ON public.motions
FOR EACH ROW EXECUTE FUNCTION public.capture_motion_before_change();
COMMIT;
