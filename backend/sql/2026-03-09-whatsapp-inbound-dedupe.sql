create extension if not exists pgcrypto;

create table if not exists public.whatsapp_inbound_events (
  id uuid primary key default gen_random_uuid(),
  meta_message_id text not null unique,
  user_id uuid null references auth.users(id) on delete set null,
  external_user_id text null,
  conversation_id uuid null,
  received_at timestamptz not null default now()
);

alter table public.whatsapp_inbound_events
  add column if not exists id uuid;

alter table public.whatsapp_inbound_events
  alter column id set default gen_random_uuid();

update public.whatsapp_inbound_events
set id = gen_random_uuid()
where id is null;

alter table public.whatsapp_inbound_events
  alter column id set not null;

alter table public.whatsapp_inbound_events
  add column if not exists user_id uuid null references auth.users(id) on delete set null;

alter table public.whatsapp_inbound_events
  add column if not exists external_user_id text null;

alter table public.whatsapp_inbound_events
  add column if not exists conversation_id uuid null;

alter table public.whatsapp_inbound_events
  add column if not exists received_at timestamptz not null default now();

alter table public.whatsapp_inbound_events
  alter column meta_message_id set not null;

do $$
declare
  pk_name text;
begin
  select conname into pk_name
  from pg_constraint
  where conrelid = 'public.whatsapp_inbound_events'::regclass
    and contype = 'p'
  limit 1;

  if pk_name is not null and pk_name <> 'whatsapp_inbound_events_pkey' then
    execute format('alter table public.whatsapp_inbound_events drop constraint %I', pk_name);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.whatsapp_inbound_events'::regclass
      and contype = 'p'
  ) then
    alter table public.whatsapp_inbound_events
      add constraint whatsapp_inbound_events_pkey primary key (id);
  end if;
exception
  when undefined_table then null;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.whatsapp_inbound_events'::regclass
      and conname = 'whatsapp_inbound_events_meta_message_id_key'
  ) then
    alter table public.whatsapp_inbound_events
      add constraint whatsapp_inbound_events_meta_message_id_key unique (meta_message_id);
  end if;
exception
  when undefined_table then null;
end $$;

create index if not exists whatsapp_inbound_events_received_at_idx
  on public.whatsapp_inbound_events (received_at desc);

notify pgrst, 'reload schema';
