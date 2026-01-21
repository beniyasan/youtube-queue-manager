import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

type OverlayRoom = {
  id: string;
  name: string;
  party_size: number;
  rotate_count: number;
  overlay_show_queue?: boolean;
};

type OverlayParticipant = {
  id: string;
  youtube_username: string;
  display_name: string | null;
  joined_at: string;
  source: string;
};

type OverlayQueueMember = {
  id: string;
  youtube_username: string;
  display_name: string | null;
  position: number;
  registered_at: string;
  source: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token || token.length > 128) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const supabase = getAdminClient();

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", token)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const { data: participants, error: participantsError } = await supabase
      .from("participants")
      .select("id,youtube_username,display_name,joined_at,source")
      .eq("room_id", token)
      .order("joined_at", { ascending: true });

    if (participantsError) {
      return NextResponse.json(
        { error: participantsError.message },
        { status: 500 }
      );
    }

    const { data: queue, error: queueError } = await supabase
      .from("waiting_queue")
      .select("id,youtube_username,display_name,position,registered_at,source")
      .eq("room_id", token)
      .order("position", { ascending: true });

    if (queueError) {
      return NextResponse.json({ error: queueError.message }, { status: 500 });
    }

    const payload = {
      room: {
        id: room.id,
        name: room.name,
        party_size: room.party_size,
        rotate_count: room.rotate_count,
        overlay_show_queue: (room as OverlayRoom).overlay_show_queue ?? true,
      },
      participants: (participants || []) as OverlayParticipant[],
      queue: (queue || []) as OverlayQueueMember[],
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
