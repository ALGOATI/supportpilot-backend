alter table public.client_settings
add column if not exists dashboard_language text not null default 'english';

update public.client_settings
set dashboard_language = 'english'
where dashboard_language is null
   or dashboard_language not in ('english', 'swedish', 'arabic');

notify pgrst, 'reload schema';
