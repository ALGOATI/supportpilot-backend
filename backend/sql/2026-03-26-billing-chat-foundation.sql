create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  name text,
  plan text not null default 'starter',
  plan_started_at timestamptz null,
  plan_expires_at timestamptz null,
  wix_order_id text null,
  created_at timestamptz not null default now(),
  constraint businesses_plan_check
    check (plan in ('starter', 'pro', 'enterprise'))
);

create index if not exists businesses_plan_idx
  on public.businesses (plan);

create table if not exists public.usage (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  month text not null,
  ai_replies_used integer not null default 0,
  created_at timestamptz not null default now(),
  constraint usage_month_check check (month ~ '^[0-9]{4}-[0-9]{2}$')
);

create unique index if not exists usage_business_month_uidx
  on public.usage (business_id, month);

create index if not exists usage_business_month_idx
  on public.usage (business_id, month);

create table if not exists public.api_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid null references public.businesses(id) on delete cascade,
  date date not null default current_date,
  tokens_used integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists api_logs_date_idx
  on public.api_logs (date);

create index if not exists api_logs_business_date_idx
  on public.api_logs (business_id, date);

insert into public.businesses (id, email, name, plan, created_at)
select
  u.id,
  lower(u.email),
  coalesce(
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'business_name', '')), ''),
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'name', '')), ''),
    nullif(split_part(lower(coalesce(u.email, '')), '@', 1), '')
  ) as name,
  case
    when lower(coalesce(cs.plan, '')) = 'pro' then 'pro'
    when lower(coalesce(cs.plan, '')) in ('enterprise', 'business') then 'enterprise'
    else 'starter'
  end as plan,
  coalesce(u.created_at, now())
from auth.users u
left join public.client_settings cs on cs.user_id = u.id
on conflict (id) do update
set
  email = excluded.email,
  name = coalesce(excluded.name, public.businesses.name),
  plan = coalesce(excluded.plan, public.businesses.plan);

update public.businesses
set plan = 'starter'
where coalesce(trim(lower(plan)), '') not in ('starter', 'pro', 'enterprise');

insert into public.usage (business_id, month, ai_replies_used, created_at)
select
  cu.client_id as business_id,
  cu.month,
  greatest(coalesce(cu.conversations_used, 0), 0) as ai_replies_used,
  coalesce(cu.created_at, now()) as created_at
from public.client_usage cu
join public.businesses b on b.id = cu.client_id
where cu.month ~ '^[0-9]{4}-[0-9]{2}$'
on conflict (business_id, month) do update
set ai_replies_used = greatest(public.usage.ai_replies_used, excluded.ai_replies_used);

create or replace function public.increment_usage_replies(
  p_business_id uuid,
  p_month text,
  p_delta integer default 1
)
returns integer
language plpgsql
as $$
declare
  next_value integer;
begin
  insert into public.usage (business_id, month, ai_replies_used)
  values (p_business_id, p_month, greatest(coalesce(p_delta, 0), 0))
  on conflict (business_id, month)
  do update set ai_replies_used =
    public.usage.ai_replies_used + greatest(coalesce(excluded.ai_replies_used, 0), 0)
  returning ai_replies_used into next_value;

  return coalesce(next_value, 0);
end;
$$;

alter table public.knowledge_base
  add column if not exists business_id uuid;

update public.knowledge_base
set business_id = user_id
where business_id is null and user_id is not null;

alter table public.knowledge_base
  alter column business_id set default auth.uid();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'knowledge_base_business_id_fkey'
  ) then
    alter table public.knowledge_base
      add constraint knowledge_base_business_id_fkey
      foreign key (business_id) references public.businesses(id) on delete cascade;
  end if;
end $$;

alter table public.knowledge_base
  alter column business_id set not null;

alter table public.knowledge_base
  drop constraint if exists knowledge_base_source_check;

alter table public.knowledge_base
  add constraint knowledge_base_source_check
  check (source in ('manual', 'learned', 'human_reply', 'imported'));

create index if not exists knowledge_base_business_updated_idx
  on public.knowledge_base (business_id, updated_at desc);

create or replace function public.set_knowledge_base_business_id()
returns trigger
language plpgsql
as $$
begin
  if new.business_id is null then
    new.business_id := coalesce(new.user_id, auth.uid());
  end if;

  if new.user_id is null then
    new.user_id := coalesce(new.business_id, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_knowledge_base_set_business_id on public.knowledge_base;
create trigger trg_knowledge_base_set_business_id
before insert or update on public.knowledge_base
for each row
execute function public.set_knowledge_base_business_id();

alter table public.businesses enable row level security;
alter table public.usage enable row level security;
alter table public.api_logs enable row level security;
alter table public.knowledge_base enable row level security;

drop policy if exists "businesses_select_own" on public.businesses;
create policy "businesses_select_own"
  on public.businesses
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "businesses_insert_own" on public.businesses;
create policy "businesses_insert_own"
  on public.businesses
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "businesses_update_own" on public.businesses;
create policy "businesses_update_own"
  on public.businesses
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "businesses_delete_own" on public.businesses;
create policy "businesses_delete_own"
  on public.businesses
  for delete
  to authenticated
  using (auth.uid() = id);

drop policy if exists "usage_select_own" on public.usage;
create policy "usage_select_own"
  on public.usage
  for select
  to authenticated
  using (auth.uid() = business_id);

drop policy if exists "usage_insert_own" on public.usage;
create policy "usage_insert_own"
  on public.usage
  for insert
  to authenticated
  with check (auth.uid() = business_id);

drop policy if exists "usage_update_own" on public.usage;
create policy "usage_update_own"
  on public.usage
  for update
  to authenticated
  using (auth.uid() = business_id)
  with check (auth.uid() = business_id);

drop policy if exists "usage_delete_own" on public.usage;
create policy "usage_delete_own"
  on public.usage
  for delete
  to authenticated
  using (auth.uid() = business_id);

drop policy if exists "api_logs_select_own" on public.api_logs;
create policy "api_logs_select_own"
  on public.api_logs
  for select
  to authenticated
  using (auth.uid() = business_id);

drop policy if exists "api_logs_insert_own" on public.api_logs;
create policy "api_logs_insert_own"
  on public.api_logs
  for insert
  to authenticated
  with check (auth.uid() = business_id);

drop policy if exists "api_logs_update_own" on public.api_logs;
create policy "api_logs_update_own"
  on public.api_logs
  for update
  to authenticated
  using (auth.uid() = business_id)
  with check (auth.uid() = business_id);

drop policy if exists "api_logs_delete_own" on public.api_logs;
create policy "api_logs_delete_own"
  on public.api_logs
  for delete
  to authenticated
  using (auth.uid() = business_id);

drop policy if exists "knowledge_base_select_own" on public.knowledge_base;
create policy "knowledge_base_select_own"
  on public.knowledge_base
  for select
  to authenticated
  using (auth.uid() = business_id);

drop policy if exists "knowledge_base_insert_own" on public.knowledge_base;
create policy "knowledge_base_insert_own"
  on public.knowledge_base
  for insert
  to authenticated
  with check (auth.uid() = business_id);

drop policy if exists "knowledge_base_update_own" on public.knowledge_base;
create policy "knowledge_base_update_own"
  on public.knowledge_base
  for update
  to authenticated
  using (auth.uid() = business_id)
  with check (auth.uid() = business_id);

drop policy if exists "knowledge_base_delete_own" on public.knowledge_base;
create policy "knowledge_base_delete_own"
  on public.knowledge_base
  for delete
  to authenticated
  using (auth.uid() = business_id);

notify pgrst, 'reload schema';
