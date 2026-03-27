create extension if not exists pgcrypto;

create table if not exists public.conversation_map (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  channel text not null,
  external_conversation_id text not null,
  conversation_id uuid not null,
  external_user_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists conversation_map_user_channel_external_uidx
  on public.conversation_map (user_id, channel, external_conversation_id);

create index if not exists conversation_map_conversation_id_idx
  on public.conversation_map (conversation_id);

alter table public.conversation_map enable row level security;

revoke all on public.conversation_map from anon;
revoke all on public.conversation_map from authenticated;
