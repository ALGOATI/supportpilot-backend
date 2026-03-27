alter table public.booking_rules
add column if not exists booking_required boolean not null default true;

alter table public.booking_rules
add column if not exists advance_notice_minutes int null;

alter table public.client_settings
add column if not exists onboarding_completed boolean not null default false;

alter table public.client_settings
add column if not exists onboarding_completed_at timestamptz null;

notify pgrst, 'reload schema';
