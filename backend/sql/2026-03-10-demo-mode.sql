alter table public.client_settings
add column if not exists demo_mode boolean not null default false;

notify pgrst, 'reload schema';
