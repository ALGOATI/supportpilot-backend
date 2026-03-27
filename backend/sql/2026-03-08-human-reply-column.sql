alter table public.messages
  add column if not exists human_reply text;

notify pgrst, 'reload schema';
