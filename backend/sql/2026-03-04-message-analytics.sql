alter table public.messages
  add column if not exists model_used text,
  add column if not exists prompt_tokens integer,
  add column if not exists completion_tokens integer,
  add column if not exists total_tokens integer,
  add column if not exists estimated_cost_usd numeric;

create index if not exists messages_user_created_at_idx
  on public.messages (user_id, created_at desc);

create index if not exists messages_user_channel_created_at_idx
  on public.messages (user_id, channel, created_at desc);

create index if not exists messages_user_conversation_created_at_idx
  on public.messages (user_id, conversation_id, created_at asc);

notify pgrst, 'reload schema';
