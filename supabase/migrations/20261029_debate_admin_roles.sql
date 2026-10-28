begin;

create table if not exists public.debate_admin_roles (
  user_id uuid primary key
    references public.debate_members(user_id)
    on delete cascade,
  created_at timestamptz not null default now(),
  suspended_at timestamptz,
  suspended_by uuid
    references public.debate_members(user_id)
    on delete set null,
  suspension_reason text
    check (
      suspension_reason is null
      or length(suspension_reason) <= 500
    )
);

-- 既存の有効なメンバーには管理者権限を付与する。
-- すでに停止状態などの情報がある行は上書きしない。
insert into public.debate_admin_roles (user_id)
select user_id
from public.debate_members
where revoked_at is null
on conflict (user_id) do nothing;

create index if not exists debate_admin_roles_active_idx
  on public.debate_admin_roles (user_id)
  where suspended_at is null;

alter table public.debate_admin_roles enable row level security;

-- ブラウザから直接アクセスさせず、サーバー側の
-- Supabase service-role API経由で操作する。
revoke all on public.debate_admin_roles
  from public, anon, authenticated;

commit;
