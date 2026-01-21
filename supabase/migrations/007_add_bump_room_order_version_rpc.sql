-- D-API3: bump order_version on non-DnD writes

CREATE OR REPLACE FUNCTION public.bump_room_order_version(p_room_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_version integer;
BEGIN
  UPDATE rooms
  SET order_version = order_version + 1
  WHERE id = p_room_id
  RETURNING order_version INTO v_new_version;

  RETURN v_new_version;
END;
$$;
