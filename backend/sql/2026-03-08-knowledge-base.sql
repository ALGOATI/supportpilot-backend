create extension if not exists pgcrypto;

create table if not exists public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer text not null,
  source text not null default 'human_reply',
  confidence text not null default 'high',
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_base_source_check check (source in ('human_reply', 'manual', 'imported')),
  constraint knowledge_base_confidence_check check (confidence in ('high', 'medium', 'low'))
);

create index if not exists knowledge_base_user_updated_idx
  on public.knowledge_base (user_id, updated_at desc);

create index if not exists knowledge_base_user_active_idx
  on public.knowledge_base (user_id, is_active);

alter table public.knowledge_base enable row level security;

drop policy if exists "knowledge_base_select_own" on public.knowledge_base;
create policy "knowledge_base_select_own"
  on public.knowledge_base
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "knowledge_base_insert_own" on public.knowledge_base;
create policy "knowledge_base_insert_own"
  on public.knowledge_base
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "knowledge_base_update_own" on public.knowledge_base;
create policy "knowledge_base_update_own"
  on public.knowledge_base
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "knowledge_base_delete_own" on public.knowledge_base;
create policy "knowledge_base_delete_own"
  on public.knowledge_base
  for delete
  to authenticated
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';
