-- Next-last reservation groundwork

-- 1) Room keyword for "next-last" reservations
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS next_last_keyword TEXT NOT NULL DEFAULT '次ラストにします';

-- 2) Reservation table
CREATE TABLE IF NOT EXISTS room_next_last (
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  youtube_username VARCHAR(200) NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, youtube_username)
);

ALTER TABLE room_next_last ENABLE ROW LEVEL SECURITY;

-- 3) RLS policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'room_next_last'
      AND policyname = 'Room owners can view next-last reservations'
  ) THEN
    CREATE POLICY "Room owners can view next-last reservations" ON room_next_last
      FOR SELECT USING (
        room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'room_next_last'
      AND policyname = 'Room owners can insert next-last reservations'
  ) THEN
    CREATE POLICY "Room owners can insert next-last reservations" ON room_next_last
      FOR INSERT WITH CHECK (
        room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'room_next_last'
      AND policyname = 'Room owners can delete next-last reservations'
  ) THEN
    CREATE POLICY "Room owners can delete next-last reservations" ON room_next_last
      FOR DELETE USING (
        room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
      );
  END IF;
END $$;
