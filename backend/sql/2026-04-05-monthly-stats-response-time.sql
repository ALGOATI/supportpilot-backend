-- Add columns to track response time accurately as a running total + count
-- avg_response_time_ms is computed on read as total_response_time_ms / response_time_count
ALTER TABLE monthly_stats ADD COLUMN IF NOT EXISTS total_response_time_ms BIGINT DEFAULT 0;
ALTER TABLE monthly_stats ADD COLUMN IF NOT EXISTS response_time_count INTEGER DEFAULT 0;

-- Update the increment RPC to handle the new columns
CREATE OR REPLACE FUNCTION increment_monthly_stat(
  biz_id UUID,
  stat_name TEXT,
  increment_by INTEGER DEFAULT 1
) RETURNS void AS $$
BEGIN
  INSERT INTO monthly_stats (business_id, month, ai_conversations_handled, ai_messages_sent, human_escalations, total_inbound_messages, total_response_time_ms, response_time_count)
  VALUES (biz_id, to_char(now(), 'YYYY-MM'), 0, 0, 0, 0, 0, 0)
  ON CONFLICT (business_id, month) DO NOTHING;

  EXECUTE format(
    'UPDATE monthly_stats SET %I = %I + $1, updated_at = now() WHERE business_id = $2 AND month = $3',
    stat_name, stat_name
  ) USING increment_by, biz_id, to_char(now(), 'YYYY-MM');
END;
$$ LANGUAGE plpgsql;
