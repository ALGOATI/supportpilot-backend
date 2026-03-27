alter table public.business_profiles
add column if not exists business_type text not null default 'other';

update public.business_profiles
set business_type = 'other'
where business_type is null
   or business_type not in ('restaurant', 'barber', 'clinic', 'retail', 'other');

notify pgrst, 'reload schema';
