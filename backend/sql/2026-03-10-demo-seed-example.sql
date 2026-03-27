-- Example manual SQL seed for one demo conversation.
-- Replace USER_ID_PLACEHOLDER with a real auth user id before running.

with demo_conversation as (
  insert into public.conversations (
    id,
    user_id,
    channel,
    title,
    status,
    last_message_at,
    last_message_preview,
    intent,
    priority,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    'USER_ID_PLACEHOLDER'::uuid,
    'dashboard',
    'Demo: vegan menu question',
    'waiting_customer',
    now(),
    'Yes, we do. We have vegan pasta, grilled vegetables, and a vegan burger.',
    'faq',
    'normal',
    now(),
    now()
  )
  returning id, user_id
)
insert into public.messages (
  user_id,
  conversation_id,
  channel,
  customer_message,
  ai_reply,
  extracted_data,
  escalated,
  model_used,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  estimated_cost_usd,
  created_at
)
select
  dc.user_id,
  dc.id,
  'dashboard',
  'Hello, do you have vegan food?',
  'Yes, we do. We have vegan pasta, grilled vegetables, and a vegan burger. Would you like the full menu highlights?',
  '{"intent":"faq","status":"incomplete","missing":[]}'::jsonb,
  false,
  'demo_seed',
  0,
  0,
  0,
  0,
  now()
from demo_conversation dc;
