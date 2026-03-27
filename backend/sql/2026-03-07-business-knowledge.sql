create extension if not exists pgcrypto;

create table if not exists public.business_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  niche text not null default 'generic',
  phone text,
  address text,
  timezone text not null default 'Europe/Stockholm',
  updated_at timestamptz not null default now()
);

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_of_week int not null,
  is_closed boolean not null default false,
  open_time text null,
  close_time text null,
  updated_at timestamptz not null default now(),
  constraint business_hours_day_of_week_check check (day_of_week between 0 and 6)
);

create unique index if not exists business_hours_user_day_uidx
  on public.business_hours (user_id, day_of_week);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  price numeric null,
  description text null,
  category text null,
  available boolean not null default true,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index if not exists menu_items_user_updated_idx
  on public.menu_items (user_id, updated_at desc);

create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer text not null,
  updated_at timestamptz not null default now()
);

create index if not exists faqs_user_updated_idx
  on public.faqs (user_id, updated_at desc);

create table if not exists public.booking_rules (
  user_id uuid primary key references auth.users(id) on delete cascade,
  booking_enabled boolean not null default true,
  require_name boolean not null default true,
  require_phone boolean not null default true,
  max_party_size int null,
  updated_at timestamptz not null default now()
);

alter table public.business_profiles enable row level security;
alter table public.business_hours enable row level security;
alter table public.menu_items enable row level security;
alter table public.faqs enable row level security;
alter table public.booking_rules enable row level security;

drop policy if exists "business_profiles_select_own" on public.business_profiles;
create policy "business_profiles_select_own"
  on public.business_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "business_profiles_insert_own" on public.business_profiles;
create policy "business_profiles_insert_own"
  on public.business_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "business_profiles_update_own" on public.business_profiles;
create policy "business_profiles_update_own"
  on public.business_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "business_profiles_delete_own" on public.business_profiles;
create policy "business_profiles_delete_own"
  on public.business_profiles
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "business_hours_select_own" on public.business_hours;
create policy "business_hours_select_own"
  on public.business_hours
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "business_hours_insert_own" on public.business_hours;
create policy "business_hours_insert_own"
  on public.business_hours
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "business_hours_update_own" on public.business_hours;
create policy "business_hours_update_own"
  on public.business_hours
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "business_hours_delete_own" on public.business_hours;
create policy "business_hours_delete_own"
  on public.business_hours
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "menu_items_select_own" on public.menu_items;
create policy "menu_items_select_own"
  on public.menu_items
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "menu_items_insert_own" on public.menu_items;
create policy "menu_items_insert_own"
  on public.menu_items
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "menu_items_update_own" on public.menu_items;
create policy "menu_items_update_own"
  on public.menu_items
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "menu_items_delete_own" on public.menu_items;
create policy "menu_items_delete_own"
  on public.menu_items
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "faqs_select_own" on public.faqs;
create policy "faqs_select_own"
  on public.faqs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "faqs_insert_own" on public.faqs;
create policy "faqs_insert_own"
  on public.faqs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "faqs_update_own" on public.faqs;
create policy "faqs_update_own"
  on public.faqs
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "faqs_delete_own" on public.faqs;
create policy "faqs_delete_own"
  on public.faqs
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "booking_rules_select_own" on public.booking_rules;
create policy "booking_rules_select_own"
  on public.booking_rules
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "booking_rules_insert_own" on public.booking_rules;
create policy "booking_rules_insert_own"
  on public.booking_rules
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "booking_rules_update_own" on public.booking_rules;
create policy "booking_rules_update_own"
  on public.booking_rules
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "booking_rules_delete_own" on public.booking_rules;
create policy "booking_rules_delete_own"
  on public.booking_rules
  for delete
  to authenticated
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';
