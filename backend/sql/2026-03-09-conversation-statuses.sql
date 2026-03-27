-- Expand conversations.status to the new support workflow states.
alter table public.conversations
  drop constraint if exists conversations_status_check;

update public.conversations
set status = 'resolved'
where status = 'closed';

alter table public.conversations
  add constraint conversations_status_check
  check (status in ('open', 'waiting_customer', 'escalated', 'resolved'));

notify pgrst, 'reload schema';
