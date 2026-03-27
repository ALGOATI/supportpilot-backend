create extension if not exists pgcrypto;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid null,
  external_user_id text null,
  customer_name text null,
  customer_phone text null,
  booking_date text null,
  booking_time text null,
  people text null,
  status text not null default 'draft',
  source_channel text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_status_check
    check (status in ('draft', 'confirmed', 'completed', 'cancelled'))
);

create index if not exists bookings_user_updated_idx
  on public.bookings (user_id, updated_at desc);

create unique index if not exists bookings_one_draft_per_conversation_uidx
  on public.bookings (user_id, conversation_id)
  where status = 'draft' and conversation_id is not null;

create unique index if not exists bookings_one_draft_per_external_user_uidx
  on public.bookings (user_id, external_user_id)
  where status = 'draft' and external_user_id is not null;

alter table public.bookings enable row level security;

drop policy if exists "bookings_select_own" on public.bookings;
create policy "bookings_select_own"
  on public.bookings
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own"
  on public.bookings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bookings_update_own" on public.bookings;
create policy "bookings_update_own"
  on public.bookings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bookings_delete_own" on public.bookings;
create policy "bookings_delete_own"
  on public.bookings
  for delete
  to authenticated
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';
