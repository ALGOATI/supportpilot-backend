create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id uuid primary key,
  user_id uuid not null,
  channel text not null,
  external_conversation_id text null,
  external_user_id text null,
  title text not null default '',
  status text not null default 'open',
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '',
  intent text not null default 'other',
  priority text not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_status_check
    check (status in ('open', 'closed', 'escalated')),
  constraint conversations_intent_check
    check (intent in ('booking', 'faq', 'complaint', 'other')),
  constraint conversations_priority_check
    check (priority in ('low', 'normal', 'high'))
);

create index if not exists conversations_user_last_message_idx
  on public.conversations (user_id, last_message_at desc);

create unique index if not exists conversations_user_channel_external_uidx
  on public.conversations (user_id, channel, external_conversation_id)
  where external_conversation_id is not null;

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own"
  on public.conversations
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "conversations_update_own" on public.conversations;
create policy "conversations_update_own"
  on public.conversations
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own"
  on public.conversations
  for insert
  to authenticated
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
