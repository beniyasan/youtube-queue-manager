ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS youtube_next_poll_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS youtube_poller_lease_id TEXT,
  ADD COLUMN IF NOT EXISTS youtube_poller_lease_until TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS youtube_polling_interval_ms INTEGER;
