import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }

    // Get room with settings
    const { data: room } = await supabase
      .from('rooms')
      .select('id, party_size, rotate_count')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!room) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    // Get current participants (position order)
    const { data: participants } = await supabase
      .from('participants')
      .select('*')
      .eq('room_id', id)
      .order('position', { ascending: true })
      .order('joined_at', { ascending: true })

    // Get waiting queue (by position)
    const { data: queue } = await supabase
      .from('waiting_queue')
      .select('*')
      .eq('room_id', id)
      .order('position', { ascending: true })

    if (!queue || queue.length === 0) {
      return NextResponse.json({ error: '待機者がいません' }, { status: 400 })
    }

    const rotateCount = Math.min(room.rotate_count, queue.length)
    
    // Get oldest participants to rotate out
    const participantsToRemove = participants?.slice(0, rotateCount) || []

    // Add from queue to participants
    const queueToMove = queue.slice(0, rotateCount)
    for (const q of queueToMove) {
      await supabase.from('participants').insert({
        room_id: id,
        youtube_username: q.youtube_username,
        display_name: q.display_name,
        source: q.source,
      })
      await supabase.from('waiting_queue').delete().eq('id', q.id)
    }

    // Get current max position in queue after promotions
    const { data: currentQueue } = await supabase
      .from('waiting_queue')
      .select('position')
      .eq('room_id', id)
      .order('position', { ascending: false })
      .limit(1)

    const maxPosition = currentQueue?.[0]?.position ?? -1
    const startPosition = maxPosition + 1

    // Move rotated participants to end of queue
    for (let i = 0; i < participantsToRemove.length; i++) {
      const p = participantsToRemove[i]
      await supabase.from('waiting_queue').insert({
        room_id: id,
        youtube_username: p.youtube_username,
        display_name: p.display_name,
        position: startPosition + i,
        source: p.source,
      })
      await supabase.from('participants').delete().eq('id', p.id)
    }

    if (rotateCount > 0) {
      const { error: bumpError } = await supabase.rpc('bump_room_order_version', {
        p_room_id: id,
      })

      if (bumpError) {
        return NextResponse.json({ error: bumpError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ 
      message: `${rotateCount}人を交代しました`,
      rotated: rotateCount 
    })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
