-- DnD reorder groundwork (0-based positions, versioning, idempotency)

-- 1) Room order versioning
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS order_version INTEGER NOT NULL DEFAULT 0;

-- 2) Participants ordering (0-based)
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS position INTEGER;

-- Backfill positions per room by joined_at order (0-based)
WITH ranked_participants AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY room_id ORDER BY joined_at ASC, id ASC) - 1 AS new_position
  FROM participants
)
UPDATE participants p
SET position = rp.new_position
FROM ranked_participants rp
WHERE p.id = rp.id;

ALTER TABLE participants
  ALTER COLUMN position SET NOT NULL;

-- Allow future reorder writes (RLS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'participants'
      AND policyname = 'Room owners can update participants'
  ) THEN
    CREATE POLICY "Room owners can update participants" ON participants
      FOR UPDATE USING (
        room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
      )
      WITH CHECK (
        room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- Ensure inserts without position keep working (append semantics, 0-based)
CREATE OR REPLACE FUNCTION participants_set_position_default()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.position IS NULL THEN
    SELECT COALESCE(MAX(position), -1) + 1
      INTO NEW.position
    FROM participants
    WHERE room_id = NEW.room_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS participants_set_position_default ON participants;
CREATE TRIGGER participants_set_position_default
  BEFORE INSERT ON participants
  FOR EACH ROW
  EXECUTE FUNCTION participants_set_position_default();

-- 3) Waiting queue: rewrite existing 1-based positions to 0-based (migration-time)
-- Offset first to avoid transient unique constraint collisions
UPDATE waiting_queue
SET position = position + 1000000;

WITH ranked_queue AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY room_id ORDER BY position ASC, id ASC) - 1 AS new_position
  FROM waiting_queue
)
UPDATE waiting_queue q
SET position = rq.new_position
FROM ranked_queue rq
WHERE q.id = rq.id;

-- 4) Idempotency table for DnD ops
CREATE TABLE IF NOT EXISTS room_dnd_ops (
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  client_op_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  op_hash TEXT,
  applied_version INTEGER,
  PRIMARY KEY (room_id, client_op_id)
);

ALTER TABLE room_dnd_ops ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'room_dnd_ops'
      AND policyname = 'Room owners can view dnd ops'
  ) THEN
    CREATE POLICY "Room owners can view dnd ops" ON room_dnd_ops
      FOR SELECT USING (
        room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'room_dnd_ops'
      AND policyname = 'Room owners can insert dnd ops'
  ) THEN
    CREATE POLICY "Room owners can insert dnd ops" ON room_dnd_ops
      FOR INSERT WITH CHECK (
        room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
      );
  END IF;
END $$;
