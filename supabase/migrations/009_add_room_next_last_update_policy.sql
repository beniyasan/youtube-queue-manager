-- Allow room owners to update next-last reservations (needed for UPSERT on conflict)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'room_next_last'
      AND policyname = 'Room owners can update next-last reservations'
  ) THEN
    CREATE POLICY "Room owners can update next-last reservations" ON room_next_last
      FOR UPDATE USING (
        room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
      )
      WITH CHECK (
        room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
      );
  END IF;
END $$;
