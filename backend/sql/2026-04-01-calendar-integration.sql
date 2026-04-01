-- Calendar integration columns
-- ICS feed token (all plans) + Google Calendar OAuth (Pro/Business)

-- Calendar feed token for ICS subscription URL
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS calendar_feed_token TEXT;

-- Google Calendar OAuth tokens (encrypted JSON with access_token, refresh_token, expiry_date)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS google_calendar_tokens JSONB;

-- Which Google Calendar to sync to (defaults to 'primary')
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS google_calendar_id TEXT DEFAULT 'primary';

-- Google Calendar event ID on bookings (for update/cancel)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS google_event_id TEXT;
