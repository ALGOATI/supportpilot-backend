create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null,
  channel text not null default 'dashboard',
  customer_message text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  error text null,
  result jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_status_check check (status in ('queued', 'processing', 'done', 'failed'))
);

create index if not exists jobs_status_created_at_idx
  on public.jobs (status, created_at);

create index if not exists jobs_user_convo_idx
  on public.jobs (user_id, conversation_id);

create index if not exists messages_user_created_at_idx
  on public.messages (user_id, created_at desc);

create index if not exists messages_user_convo_created_at_idx
  on public.messages (user_id, conversation_id, created_at asc);

notify pgrst, 'reload schema';
