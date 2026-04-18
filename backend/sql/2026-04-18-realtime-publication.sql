-- Enable Supabase Realtime for the inbox tables so the dashboard updates live
-- when new messages arrive or conversation state changes. Without these in the
-- supabase_realtime publication, postgres_changes subscriptions never fire.
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Realtime needs REPLICA IDENTITY FULL to deliver row-level payloads (old/new)
-- for UPDATE/DELETE; otherwise only PK columns come through.
ALTER TABLE conversations REPLICA IDENTITY FULL;
ALTER TABLE messages REPLICA IDENTITY FULL;
