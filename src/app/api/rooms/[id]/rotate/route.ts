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

    // Get current participants (oldest first)
    const { data: participants } = await supabase
      .from('participants')
      .select('*')
      .eq('room_id', id)
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
    
    // Remove oldest participants
    const participantsToRemove = participants?.slice(0, rotateCount) || []
    for (const p of participantsToRemove) {
      await supabase.from('participants').delete().eq('id', p.id)
    }

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

    // Reorder remaining queue
    const { data: remainingQueue } = await supabase
      .from('waiting_queue')
      .select('id, position')
      .eq('room_id', id)
      .order('position', { ascending: true })

    if (remainingQueue) {
      for (let i = 0; i < remainingQueue.length; i++) {
        await supabase
          .from('waiting_queue')
          .update({ position: i + 1 })
          .eq('id', remainingQueue[i].id)
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
