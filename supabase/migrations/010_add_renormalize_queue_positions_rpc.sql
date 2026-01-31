-- Optimize queue position renormalization from N+1 queries to single query

CREATE OR REPLACE FUNCTION public.renormalize_queue_positions(p_room_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  WITH numbered AS (
    SELECT
      id,
      row_number() OVER (ORDER BY position ASC, id ASC) - 1 as new_position
    FROM waiting_queue
    WHERE room_id = p_room_id
  )
  UPDATE waiting_queue w
  SET position = n.new_position
  FROM numbered n
  WHERE w.id = n.id;
$$;
