alter table public.business_profiles
add column if not exists business_owner_phone text;

alter table public.conversations
add column if not exists ai_paused boolean not null default false;

update public.conversations
set ai_paused = true
where status = 'escalated';

notify pgrst, 'reload schema';
