
-- File: supabase/migrations/20261028_debate_auth.sql
-- Purpose: Individual login codes, browser sessions and login rate limits.
-- This migration is intentionally NOT applied automatically.

begin;

-- One active login-code record per registered member.
-- Only SHA-256 hashes are stored; plaintext login codes are never stored.
create table if not exists public.debate_login_codes (
  user_id uuid primary key
    references public.debate_members(user_id)
    on delete cascade,
  code_hash text not null unique
    check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Opaque browser sessions. Store only the token hash.
create table if not exists public.debate_sessions (
  token_hash text primary key
    check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null
    references public.debate_members(user_id)
    on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists debate_sessions_user_id_idx
  on public.debate_sessions (user_id);

create index if not exists debate_sessions_expires_at_idx
  on public.debate_sessions (expires_at);

-- Sliding-window login-attempt buckets.
-- bucket_hash should be a server-generated hash of a rate-limit key,
-- not a raw IP address or a plaintext login code.
create table if not exists public.debate_login_attempt_limits (
  bucket_hash text primary key
    check (bucket_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null default 0
    check (attempts >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists debate_login_attempt_limits_updated_idx
  on public.debate_login_attempt_limits (updated_at);

-- Atomically count attempts within a one-hour window.
-- Returns true when the attempt is allowed and counted.
-- Returns false when the bucket has already reached the limit.
create or replace function public.debate_consume_login_attempt(
  p_bucket_hash text,
  p_max_attempts integer default 20
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_started timestamptz;
  v_attempts integer;
begin
  if p_bucket_hash is null
     or p_bucket_hash !~ '^[0-9a-f]{64}$'
     or p_max_attempts < 1
     or p_max_attempts > 100 then
    raise exception 'INVALID_LOGIN_LIMIT_ARGUMENT';
  end if;

  insert into public.debate_login_attempt_limits (
    bucket_hash,
    window_started_at,
    attempts,
    updated_at
  )
  values (
    p_bucket_hash,
    v_now,
    0,
    v_now
  )
  on conflict (bucket_hash) do nothing;

  select window_started_at, attempts
    into v_started, v_attempts
    from public.debate_login_attempt_limits
   where bucket_hash = p_bucket_hash
   for update;

  if v_started <= v_now - interval '1 hour' then
    update public.debate_login_attempt_limits
       set window_started_at = v_now,
           attempts = 1,
           updated_at = v_now
     where bucket_hash = p_bucket_hash;

    return true;
  end if;

  if v_attempts >= p_max_attempts then
    update public.debate_login_attempt_limits
       set updated_at = v_now
     where bucket_hash = p_bucket_hash;

    return false;
  end if;

  update public.debate_login_attempt_limits
     set attempts = v_attempts + 1,
         updated_at = v_now
   where bucket_hash = p_bucket_hash;

  return true;
end;
$function$;

-- Do not grant this function to anonymous or authenticated clients.
-- The server should call it using the Supabase service-role credential.
revoke all on function public.debate_consume_login_attempt(text, integer)
  from public, anon, authenticated;

commit;
