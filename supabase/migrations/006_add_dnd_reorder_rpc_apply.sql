-- D-DB2: RPC for atomic DnD order apply (participants + waiting_queue)

CREATE OR REPLACE FUNCTION public.apply_room_dnd_order(
  p_room_id uuid,
  p_expected_version integer,
  p_client_op_id uuid,
  p_desired_party_usernames text[],
  p_desired_queue_usernames text[],
  p_op_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_room_user_id uuid;
  v_current_version integer;
  v_party_size integer;
  v_new_version integer;
  v_existing_op_hash text;

  v_party text[] := COALESCE(p_desired_party_usernames, '{}'::text[]);
  v_queue text[] := COALESCE(p_desired_queue_usernames, '{}'::text[]);

  v_party_len integer := COALESCE(array_length(v_party, 1), 0);
  v_queue_len integer := COALESCE(array_length(v_queue, 1), 0);

  v_total_len integer;
  v_distinct_len integer;
  v_has_null_or_blank boolean;
  v_missing boolean;
  v_extra boolean;
BEGIN
  -- Lock the room row to serialize concurrent applies.
  SELECT user_id, order_version, party_size
    INTO v_room_user_id, v_current_version, v_party_size
  FROM rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'reject',
      'version', NULL,
      'participants', '[]'::jsonb,
      'queue', '[]'::jsonb
    );
  END IF;

  -- Ownership check (required even if called under elevated role).
  IF auth.uid() IS NULL OR auth.uid() <> v_room_user_id THEN
    RETURN (
      SELECT jsonb_build_object(
        'status', 'reject',
        'version', v_current_version,
        'participants', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'youtube_username', p.youtube_username,
                'display_name', p.display_name,
                'position', p.position,
                'joined_at', p.joined_at,
                'source', p.source
              )
              ORDER BY p.position ASC
            )
            FROM participants p
            WHERE p.room_id = p_room_id
          ),
          '[]'::jsonb
        ),
        'queue', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'youtube_username', q.youtube_username,
                'display_name', q.display_name,
                'position', q.position,
                'registered_at', q.registered_at,
                'source', q.source
              )
              ORDER BY q.position ASC
            )
            FROM waiting_queue q
            WHERE q.room_id = p_room_id
          ),
          '[]'::jsonb
        )
      )
    );
  END IF;

  -- Idempotency check (replay / op_id_mismatch) - bypasses version conflicts.
  SELECT op_hash
    INTO v_existing_op_hash
  FROM room_dnd_ops
  WHERE room_id = p_room_id
    AND client_op_id = p_client_op_id;

  IF FOUND THEN
    IF p_op_hash IS NULL OR v_existing_op_hash IS NULL OR v_existing_op_hash = p_op_hash THEN
      RETURN (
        SELECT jsonb_build_object(
          'status', 'replay',
          'version', v_current_version,
          'participants', COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', p.id,
                  'youtube_username', p.youtube_username,
                  'display_name', p.display_name,
                  'position', p.position,
                  'joined_at', p.joined_at,
                  'source', p.source
                )
                ORDER BY p.position ASC
              )
              FROM participants p
              WHERE p.room_id = p_room_id
            ),
            '[]'::jsonb
          ),
          'queue', COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', q.id,
                  'youtube_username', q.youtube_username,
                  'display_name', q.display_name,
                  'position', q.position,
                  'registered_at', q.registered_at,
                  'source', q.source
                )
                ORDER BY q.position ASC
              )
              FROM waiting_queue q
              WHERE q.room_id = p_room_id
            ),
            '[]'::jsonb
          )
        )
      );
    END IF;

    RETURN (
      SELECT jsonb_build_object(
        'status', 'op_id_mismatch',
        'version', v_current_version,
        'participants', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'youtube_username', p.youtube_username,
                'display_name', p.display_name,
                'position', p.position,
                'joined_at', p.joined_at,
                'source', p.source
              )
              ORDER BY p.position ASC
            )
            FROM participants p
            WHERE p.room_id = p_room_id
          ),
          '[]'::jsonb
        ),
        'queue', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'youtube_username', q.youtube_username,
                'display_name', q.display_name,
                'position', q.position,
                'registered_at', q.registered_at,
                'source', q.source
              )
              ORDER BY q.position ASC
            )
            FROM waiting_queue q
            WHERE q.room_id = p_room_id
          ),
          '[]'::jsonb
        )
      )
    );
  END IF;

  -- Optimistic concurrency (version check).
  IF v_current_version <> p_expected_version THEN
    RETURN (
      SELECT jsonb_build_object(
        'status', 'version_conflict',
        'version', v_current_version,
        'participants', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'youtube_username', p.youtube_username,
                'display_name', p.display_name,
                'position', p.position,
                'joined_at', p.joined_at,
                'source', p.source
              )
              ORDER BY p.position ASC
            )
            FROM participants p
            WHERE p.room_id = p_room_id
          ),
          '[]'::jsonb
        ),
        'queue', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'youtube_username', q.youtube_username,
                'display_name', q.display_name,
                'position', q.position,
                'registered_at', q.registered_at,
                'source', q.source
              )
              ORDER BY q.position ASC
            )
            FROM waiting_queue q
            WHERE q.room_id = p_room_id
          ),
          '[]'::jsonb
        )
      )
    );
  END IF;

  -- Validate desired arrays.
  IF v_party_len > v_party_size THEN
    RETURN (
      SELECT jsonb_build_object(
        'status', 'reject',
        'version', v_current_version,
        'participants', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'youtube_username', p.youtube_username,
                'display_name', p.display_name,
                'position', p.position,
                'joined_at', p.joined_at,
                'source', p.source
              )
              ORDER BY p.position ASC
            )
            FROM participants p
            WHERE p.room_id = p_room_id
          ),
          '[]'::jsonb
        ),
        'queue', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'youtube_username', q.youtube_username,
                'display_name', q.display_name,
                'position', q.position,
                'registered_at', q.registered_at,
                'source', q.source
              )
              ORDER BY q.position ASC
            )
            FROM waiting_queue q
            WHERE q.room_id = p_room_id
          ),
          '[]'::jsonb
        )
      )
    );
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM unnest(v_party || v_queue) AS x
    WHERE x IS NULL OR btrim(x) = ''
  ) INTO v_has_null_or_blank;

  IF v_has_null_or_blank THEN
    RETURN (
      SELECT jsonb_build_object(
        'status', 'reject',
        'version', v_current_version,
        'participants', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'youtube_username', p.youtube_username,
                'display_name', p.display_name,
                'position', p.position,
                'joined_at', p.joined_at,
                'source', p.source
              )
              ORDER BY p.position ASC
            )
            FROM participants p
            WHERE p.room_id = p_room_id
          ),
          '[]'::jsonb
        ),
        'queue', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'youtube_username', q.youtube_username,
                'display_name', q.display_name,
                'position', q.position,
                'registered_at', q.registered_at,
                'source', q.source
              )
              ORDER BY q.position ASC
            )
            FROM waiting_queue q
            WHERE q.room_id = p_room_id
          ),
          '[]'::jsonb
        )
      )
    );
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(DISTINCT x)::integer
  INTO v_total_len, v_distinct_len
  FROM unnest(v_party || v_queue) AS x;

  IF v_total_len <> v_distinct_len THEN
    RETURN (
      SELECT jsonb_build_object(
        'status', 'reject',
        'version', v_current_version,
        'participants', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'youtube_username', p.youtube_username,
                'display_name', p.display_name,
                'position', p.position,
                'joined_at', p.joined_at,
                'source', p.source
              )
              ORDER BY p.position ASC
            )
            FROM participants p
            WHERE p.room_id = p_room_id
          ),
          '[]'::jsonb
        ),
        'queue', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'youtube_username', q.youtube_username,
                'display_name', q.display_name,
                'position', q.position,
                'registered_at', q.registered_at,
                'source', q.source
              )
              ORDER BY q.position ASC
            )
            FROM waiting_queue q
            WHERE q.room_id = p_room_id
          ),
          '[]'::jsonb
        )
      )
    );
  END IF;

  -- All desired usernames must exist in the room, and the desired set must match existing membership.
  SELECT EXISTS(
    WITH desired AS (
      SELECT unnest(v_party) AS youtube_username
      UNION
      SELECT unnest(v_queue) AS youtube_username
    ),
    existing AS (
      SELECT youtube_username FROM participants WHERE room_id = p_room_id
      UNION
      SELECT youtube_username FROM waiting_queue WHERE room_id = p_room_id
    )
    SELECT 1
    FROM (
      SELECT youtube_username FROM desired
      EXCEPT
      SELECT youtube_username FROM existing
    ) m
    LIMIT 1
  ) INTO v_missing;

  SELECT EXISTS(
    WITH desired AS (
      SELECT unnest(v_party) AS youtube_username
      UNION
      SELECT unnest(v_queue) AS youtube_username
    ),
    existing AS (
      SELECT youtube_username FROM participants WHERE room_id = p_room_id
      UNION
      SELECT youtube_username FROM waiting_queue WHERE room_id = p_room_id
    )
    SELECT 1
    FROM (
      SELECT youtube_username FROM existing
      EXCEPT
      SELECT youtube_username FROM desired
    ) e
    LIMIT 1
  ) INTO v_extra;

  IF v_missing OR v_extra THEN
    RETURN (
      SELECT jsonb_build_object(
        'status', 'reject',
        'version', v_current_version,
        'participants', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'youtube_username', p.youtube_username,
                'display_name', p.display_name,
                'position', p.position,
                'joined_at', p.joined_at,
                'source', p.source
              )
              ORDER BY p.position ASC
            )
            FROM participants p
            WHERE p.room_id = p_room_id
          ),
          '[]'::jsonb
        ),
        'queue', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'youtube_username', q.youtube_username,
                'display_name', q.display_name,
                'position', q.position,
                'registered_at', q.registered_at,
                'source', q.source
              )
              ORDER BY q.position ASC
            )
            FROM waiting_queue q
            WHERE q.room_id = p_room_id
          ),
          '[]'::jsonb
        )
      )
    );
  END IF;

  -- Lock participant + queue rows for safety during membership changes.
  PERFORM 1 FROM participants WHERE room_id = p_room_id FOR UPDATE;
  PERFORM 1 FROM waiting_queue WHERE room_id = p_room_id FOR UPDATE;

  -- Avoid UNIQUE(room_id, position) collisions during reindexing.
  UPDATE waiting_queue
  SET position = position + 1000000
  WHERE room_id = p_room_id;

  -- Move users that should be in queue (by username) from participants -> waiting_queue.
  WITH desired_queue AS (
    SELECT
      btrim(u.youtube_username) AS youtube_username,
      (u.ord - 1)::integer AS position
    FROM unnest(v_queue) WITH ORDINALITY AS u(youtube_username, ord)
  ),
  moved AS (
    DELETE FROM participants p
    USING desired_queue dq
    WHERE p.room_id = p_room_id
      AND p.youtube_username = dq.youtube_username
    RETURNING p.*
  )
  INSERT INTO waiting_queue (
    id,
    room_id,
    youtube_username,
    display_name,
    position,
    registered_at,
    source
  )
  SELECT
    m.id,
    m.room_id,
    m.youtube_username,
    m.display_name,
    dq.position,
    m.joined_at,
    m.source
  FROM moved m
  JOIN desired_queue dq
    ON dq.youtube_username = m.youtube_username
  ON CONFLICT (room_id, youtube_username)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    source = EXCLUDED.source,
    registered_at = EXCLUDED.registered_at;

  -- Move users that should be in party from waiting_queue -> participants.
  WITH desired_party AS (
    SELECT
      btrim(u.youtube_username) AS youtube_username,
      (u.ord - 1)::integer AS position
    FROM unnest(v_party) WITH ORDINALITY AS u(youtube_username, ord)
  ),
  moved AS (
    DELETE FROM waiting_queue q
    USING desired_party dp
    WHERE q.room_id = p_room_id
      AND q.youtube_username = dp.youtube_username
    RETURNING q.*
  )
  INSERT INTO participants (
    id,
    room_id,
    youtube_username,
    display_name,
    joined_at,
    source,
    position
  )
  SELECT
    m.id,
    m.room_id,
    m.youtube_username,
    m.display_name,
    m.registered_at,
    m.source,
    dp.position
  FROM moved m
  JOIN desired_party dp
    ON dp.youtube_username = m.youtube_username
  ON CONFLICT (room_id, youtube_username)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    source = EXCLUDED.source,
    joined_at = EXCLUDED.joined_at,
    position = EXCLUDED.position;

  -- Apply 0-based participant positions.
  UPDATE participants p
  SET position = dp.position
  FROM (
    SELECT
      btrim(u.youtube_username) AS youtube_username,
      (u.ord - 1)::integer AS position
    FROM unnest(v_party) WITH ORDINALITY AS u(youtube_username, ord)
  ) dp
  WHERE p.room_id = p_room_id
    AND p.youtube_username = dp.youtube_username;

  -- Two-phase waiting_queue position rewrite to avoid UNIQUE swaps.
  UPDATE waiting_queue
  SET position = position + 2000000
  WHERE room_id = p_room_id;

  UPDATE waiting_queue q
  SET position = dq.position
  FROM (
    SELECT
      btrim(u.youtube_username) AS youtube_username,
      (u.ord - 1)::integer AS position
    FROM unnest(v_queue) WITH ORDINALITY AS u(youtube_username, ord)
  ) dq
  WHERE q.room_id = p_room_id
    AND q.youtube_username = dq.youtube_username;

  -- Bump version and record op.
  v_new_version := v_current_version + 1;

  UPDATE rooms
  SET order_version = v_new_version,
      updated_at = now()
  WHERE id = p_room_id;

  INSERT INTO room_dnd_ops (room_id, client_op_id, op_hash, applied_version)
  VALUES (p_room_id, p_client_op_id, p_op_hash, v_new_version);

  RETURN (
    SELECT jsonb_build_object(
      'status', 'ok',
      'version', v_new_version,
      'participants', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', p.id,
              'youtube_username', p.youtube_username,
              'display_name', p.display_name,
              'position', p.position,
              'joined_at', p.joined_at,
              'source', p.source
            )
            ORDER BY p.position ASC
          )
          FROM participants p
          WHERE p.room_id = p_room_id
        ),
        '[]'::jsonb
      ),
      'queue', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', q.id,
              'youtube_username', q.youtube_username,
              'display_name', q.display_name,
              'position', q.position,
              'registered_at', q.registered_at,
              'source', q.source
            )
            ORDER BY q.position ASC
          )
          FROM waiting_queue q
          WHERE q.room_id = p_room_id
        ),
        '[]'::jsonb
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_room_dnd_order(uuid, integer, uuid, text[], text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_room_dnd_order(uuid, integer, uuid, text[], text[], text) TO authenticated;
