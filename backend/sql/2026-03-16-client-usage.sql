create table if not exists public.client_usage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  month text not null,
  conversations_used integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists client_usage_client_month_uidx
  on public.client_usage (client_id, month);

create index if not exists client_usage_client_month_idx
  on public.client_usage (client_id, month);

-- One row per conversation per month to avoid double-count increments under concurrency.
create table if not exists public.client_usage_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  month text not null,
  conversation_id uuid not null,
  created_at timestamptz not null default now()
);

create unique index if not exists client_usage_conversations_client_month_conversation_uidx
  on public.client_usage_conversations (client_id, month, conversation_id);

create index if not exists client_usage_conversations_client_month_idx
  on public.client_usage_conversations (client_id, month);

create or replace function public.increment_client_usage(
  p_client_id uuid,
  p_month text,
  p_delta integer default 1
)
returns integer
language plpgsql
as $$
declare
  next_value integer;
begin
  insert into public.client_usage (client_id, month, conversations_used)
  values (p_client_id, p_month, greatest(coalesce(p_delta, 0), 0))
  on conflict (client_id, month)
  do update set conversations_used =
    public.client_usage.conversations_used + greatest(coalesce(excluded.conversations_used, 0), 0)
  returning conversations_used into next_value;

  return coalesce(next_value, 0);
end;
$$;

notify pgrst, 'reload schema';
