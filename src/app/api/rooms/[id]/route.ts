import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { extractVideoId } from '@/lib/youtube'

export async function GET(
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

    const { data: room, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !room) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    return NextResponse.json({ room })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }

    const body = await request.json()
    const { name, youtube_url, keyword, party_size, rotate_count, next_last_keyword } = body

    let trimmedNextLastKeyword: string | undefined
    if (typeof next_last_keyword !== 'undefined') {
      if (typeof next_last_keyword !== 'string') {
        return NextResponse.json({ error: '次ラストキーワードは必須です' }, { status: 400 })
      }

      const trimmed = next_last_keyword.trim()
      if (!trimmed) {
        return NextResponse.json({ error: '次ラストキーワードは必須です' }, { status: 400 })
      }

      trimmedNextLastKeyword = trimmed
    }

    const youtube_video_id = youtube_url ? extractVideoId(youtube_url) : null

    const { data: room, error } = await supabase
      .from('rooms')
      .update({
        name,
        youtube_url: youtube_url || null,
        youtube_video_id,
        keyword,
        party_size,
        rotate_count,
        ...(trimmedNextLastKeyword !== undefined
          ? { next_last_keyword: trimmedNextLastKeyword }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!room) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    let orderOrMembershipChanged = false

    // Handle party_size changes
    const { count: participantCount } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id)

    const currentParticipantCount = participantCount || 0

    // Case 1: party_size reduction - move excess participants to queue
    if (currentParticipantCount > party_size) {
      const excessCount = currentParticipantCount - party_size

      // Get excess participants (oldest by joined_at)
      const { data: excessParticipants } = await supabase
        .from('participants')
        .select('*')
        .eq('room_id', id)
        .order('joined_at', { ascending: true })
        .limit(excessCount)

      if (excessParticipants && excessParticipants.length > 0) {
        orderOrMembershipChanged = true
        // Shift existing queue positions up by excessCount
        const { data: allQueue } = await supabase
          .from('waiting_queue')
          .select('id, position')
          .eq('room_id', id)
          .order('position', { ascending: true })

        if (allQueue) {
          for (const q of allQueue) {
            await supabase
              .from('waiting_queue')
              .update({ position: q.position + excessCount })
              .eq('id', q.id)
          }
        }

        // Insert excess participants at the front of queue
        for (let i = 0; i < excessParticipants.length; i++) {
          const p = excessParticipants[i]
          await supabase.from('waiting_queue').insert({
            room_id: id,
            youtube_username: p.youtube_username,
            display_name: p.display_name,
            position: i,
            source: p.source,
          })
        }

        // Remove excess participants
        const excessIds = excessParticipants.map(p => p.id)
        await supabase
          .from('participants')
          .delete()
          .in('id', excessIds)
      }
    }

    // Case 2: party_size increase - promote waiting queue to participants
    if (currentParticipantCount < party_size) {
      const availableSlots = party_size - currentParticipantCount

      // Get top waiting queue members by position
      const { data: queueToPromote } = await supabase
        .from('waiting_queue')
        .select('*')
        .eq('room_id', id)
        .order('position', { ascending: true })
        .limit(availableSlots)

      if (queueToPromote && queueToPromote.length > 0) {
        orderOrMembershipChanged = true
        // Add to participants
        for (const q of queueToPromote) {
          await supabase.from('participants').insert({
            room_id: id,
            youtube_username: q.youtube_username,
            display_name: q.display_name,
            source: q.source,
          })
        }

        // Remove from queue
        const promoteIds = queueToPromote.map(q => q.id)
        await supabase
          .from('waiting_queue')
          .delete()
          .in('id', promoteIds)

        // Reorder remaining queue positions
        const { data: remainingQueue } = await supabase
          .from('waiting_queue')
          .select('id, position')
          .eq('room_id', id)
          .order('position', { ascending: true })

        if (remainingQueue) {
          for (let i = 0; i < remainingQueue.length; i++) {
            await supabase
              .from('waiting_queue')
              .update({ position: i })
              .eq('id', remainingQueue[i].id)
          }
        }
      }
    }

    if (orderOrMembershipChanged) {
      const { error: bumpError } = await supabase.rpc('bump_room_order_version', {
        p_room_id: id,
      })

      if (bumpError) {
        return NextResponse.json({ error: bumpError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ room })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}

export async function DELETE(
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

    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'ルームを削除しました' })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
