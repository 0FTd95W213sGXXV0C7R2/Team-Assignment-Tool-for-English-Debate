-- DO NOT APPLY.
-- The development database already provides the bigint RPC signatures:
-- motion_apply(text, text, jsonb, bigint, text)
-- motion_restore_revision_checked(text, bigint, bigint)
--
-- The previous contents of this file attempted to replace those functions
-- with integer signatures and changed audit behavior. This guard deliberately
-- aborts before any DDL so an accidental migration run cannot modify the
-- existing RPCs, triggers, write limits, audit history, or RLS policies.
DO $$
BEGIN
  RAISE EXCEPTION
    'This migration is disabled: review the existing bigint Supabase RPCs before making schema changes';
END;
$$;
