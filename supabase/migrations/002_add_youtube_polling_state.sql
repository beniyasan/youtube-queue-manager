ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS youtube_live_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS youtube_next_page_token TEXT;
