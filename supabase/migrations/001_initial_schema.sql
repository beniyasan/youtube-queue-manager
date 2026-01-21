-- Create rooms table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  youtube_url TEXT,
  youtube_video_id VARCHAR(50),
  keyword VARCHAR(100) DEFAULT '参加',
  party_size INTEGER NOT NULL DEFAULT 4,
  rotate_count INTEGER NOT NULL DEFAULT 1,
  is_monitoring BOOLEAN DEFAULT FALSE,
  last_comment_id VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create participants table
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  youtube_username VARCHAR(200) NOT NULL,
  display_name VARCHAR(200),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'youtube')),
  UNIQUE(room_id, youtube_username)
);

-- Create waiting_queue table
CREATE TABLE waiting_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  youtube_username VARCHAR(200) NOT NULL,
  display_name VARCHAR(200),
  position INTEGER NOT NULL,
  registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'youtube')),
  UNIQUE(room_id, youtube_username),
  UNIQUE(room_id, position)
);

-- Create indexes
CREATE INDEX idx_rooms_user_id ON rooms(user_id);
CREATE INDEX idx_participants_room_id ON participants(room_id);
CREATE INDEX idx_waiting_queue_room_id_position ON waiting_queue(room_id, position);

-- Enable Row Level Security
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiting_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rooms
CREATE POLICY "Users can view own rooms" ON rooms
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own rooms" ON rooms
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own rooms" ON rooms
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own rooms" ON rooms
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for participants
CREATE POLICY "Room owners can view participants" ON participants
  FOR SELECT USING (
    room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
  );

CREATE POLICY "Room owners can add participants" ON participants
  FOR INSERT WITH CHECK (
    room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
  );

CREATE POLICY "Room owners can delete participants" ON participants
  FOR DELETE USING (
    room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
  );

-- RLS Policies for waiting_queue
CREATE POLICY "Room owners can view queue" ON waiting_queue
  FOR SELECT USING (
    room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
  );

CREATE POLICY "Room owners can add to queue" ON waiting_queue
  FOR INSERT WITH CHECK (
    room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
  );

CREATE POLICY "Room owners can update queue" ON waiting_queue
  FOR UPDATE USING (
    room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
  );

CREATE POLICY "Room owners can delete from queue" ON waiting_queue
  FOR DELETE USING (
    room_id IN (SELECT id FROM rooms WHERE user_id = auth.uid())
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for rooms updated_at
CREATE TRIGGER update_rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
