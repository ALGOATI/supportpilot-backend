alter table public.client_settings
add column if not exists plan text not null default 'starter';

update public.client_settings
set plan = 'starter'
where coalesce(trim(lower(plan)), '') in ('', 'standard', 'basic');

update public.client_settings
set plan = 'enterprise'
where coalesce(trim(lower(plan)), '') = 'business';

update public.client_settings
set plan = 'starter'
where coalesce(trim(lower(plan)), '') not in ('starter', 'pro', 'enterprise');

notify pgrst, 'reload schema';
