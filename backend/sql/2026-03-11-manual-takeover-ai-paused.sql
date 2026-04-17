alter table public.conversations
add column if not exists ai_paused boolean not null default false;

update public.conversations
set ai_paused = true
where status = 'escalated';

notify pgrst, 'reload schema';
