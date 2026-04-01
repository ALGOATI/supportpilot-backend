-- Monthly stats table for AI conversation counters per business
CREATE TABLE IF NOT EXISTS monthly_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  month TEXT NOT NULL,  -- format: '2026-04'
  ai_conversations_handled INTEGER DEFAULT 0,
  ai_messages_sent INTEGER DEFAULT 0,
  human_escalations INTEGER DEFAULT 0,
  total_inbound_messages INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_stats_business_month ON monthly_stats(business_id, month);

-- Atomic increment RPC to avoid race conditions
CREATE OR REPLACE FUNCTION increment_monthly_stat(
  biz_id UUID,
  stat_name TEXT,
  increment_by INTEGER DEFAULT 1
) RETURNS void AS $$
BEGIN
  INSERT INTO monthly_stats (business_id, month, ai_conversations_handled, ai_messages_sent, human_escalations, total_inbound_messages)
  VALUES (biz_id, to_char(now(), 'YYYY-MM'), 0, 0, 0, 0)
  ON CONFLICT (business_id, month) DO NOTHING;

  EXECUTE format(
    'UPDATE monthly_stats SET %I = %I + $1, updated_at = now() WHERE business_id = $2 AND month = $3',
    stat_name, stat_name
  ) USING increment_by, biz_id, to_char(now(), 'YYYY-MM');
END;
$$ LANGUAGE plpgsql;
