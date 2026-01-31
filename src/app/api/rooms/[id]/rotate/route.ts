import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

function uniqStrings(values: string[]) {
  return Array.from(new Set(values))
}

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
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, party_size, rotate_count, is_monitoring, order_version')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (roomError) {
      return NextResponse.json({ error: roomError.message }, { status: 500 })
    }

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

    const removed_next_last_party: string[] = []
    const removed_next_last_queue: string[] = []
    const rotated_regular: string[] = []
    const promoted: string[] = []

    if (!room.is_monitoring) {
      if (!queue || queue.length === 0) {
        return NextResponse.json({ error: '待機者がいません' }, { status: 400 })
      }

      const rotateCount = Math.min(room.rotate_count, queue.length)
      const participantsToRemove = (participants || []).slice(0, rotateCount)
      const queueToMove = queue.slice(0, rotateCount)

      for (const q of queueToMove) {
        promoted.push(q.youtube_username)
      }
      for (const p of participantsToRemove) {
        rotated_regular.push(p.youtube_username)
      }

      if (queueToMove.length > 0) {
        const { error: insertError } = await supabase.from('participants').insert(
          queueToMove.map((q) => ({
            room_id: id,
            youtube_username: q.youtube_username,
            display_name: q.display_name,
            source: q.source,
          }))
        )

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 })
        }

        const { error: deleteError } = await supabase
          .from('waiting_queue')
          .delete()
          .in(
            'id',
            queueToMove.map((q) => q.id)
          )

        if (deleteError) {
          return NextResponse.json({ error: deleteError.message }, { status: 500 })
        }
      }

      if (participantsToRemove.length > 0) {
        const { data: currentQueue } = await supabase
          .from('waiting_queue')
          .select('position')
          .eq('room_id', id)
          .order('position', { ascending: false })
          .limit(1)

        const maxPosition = currentQueue?.[0]?.position ?? -1
        const startPosition = maxPosition + 1

        const { error: insertError } = await supabase.from('waiting_queue').insert(
          participantsToRemove.map((p, index) => ({
            room_id: id,
            youtube_username: p.youtube_username,
            display_name: p.display_name,
            position: startPosition + index,
            source: p.source,
          }))
        )

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 })
        }

        const { error: deleteError } = await supabase
          .from('participants')
          .delete()
          .in(
            'id',
            participantsToRemove.map((p) => p.id)
          )

        if (deleteError) {
          return NextResponse.json({ error: deleteError.message }, { status: 500 })
        }
      }
    } else {
      const { data: nextLastReservations, error: nextLastError } = await supabase
        .from('room_next_last')
        .select('youtube_username')
        .eq('room_id', id)

      if (nextLastError) {
        return NextResponse.json({ error: nextLastError.message }, { status: 500 })
      }

      const nextLastSet = new Set(
        (nextLastReservations || []).map((reservation) => reservation.youtube_username)
      )

      const participantRows = participants || []
      const queueRows = queue || []

      const nextLastQueueRows = queueRows.filter((q) => nextLastSet.has(q.youtube_username))
      const nextLastPartyRows = participantRows.filter((p) => nextLastSet.has(p.youtube_username))

      for (const q of nextLastQueueRows) {
        removed_next_last_queue.push(q.youtube_username)
      }
      for (const p of nextLastPartyRows) {
        removed_next_last_party.push(p.youtube_username)
      }

      const hasAnyNextLast = removed_next_last_party.length > 0 || removed_next_last_queue.length > 0
      if (queueRows.length === 0 && !hasAnyNextLast) {
        return NextResponse.json({ error: '交代できる対象がありません' }, { status: 400 })
      }

      if (nextLastQueueRows.length > 0) {
        const { error } = await supabase
          .from('waiting_queue')
          .delete()
          .in(
            'id',
            nextLastQueueRows.map((q) => q.id)
          )

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      }

      if (nextLastPartyRows.length > 0) {
        const { error } = await supabase
          .from('participants')
          .delete()
          .in(
            'id',
            nextLastPartyRows.map((p) => p.id)
          )

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      }

      const remainingRotate = Math.max(0, room.rotate_count - removed_next_last_party.length)
      const participantsAfterNextLastRemoval = participantRows.filter(
        (p) => !nextLastSet.has(p.youtube_username)
      )

      const rotatedParticipants = participantsAfterNextLastRemoval.slice(0, remainingRotate)
      for (const p of rotatedParticipants) {
        rotated_regular.push(p.youtube_username)
      }

      if (rotatedParticipants.length > 0) {
        const { data: currentQueue } = await supabase
          .from('waiting_queue')
          .select('position')
          .eq('room_id', id)
          .order('position', { ascending: false })
          .limit(1)

        const maxPosition = currentQueue?.[0]?.position ?? -1
        const startPosition = maxPosition + 1

        const { error: insertError } = await supabase.from('waiting_queue').insert(
          rotatedParticipants.map((p, index) => ({
            room_id: id,
            youtube_username: p.youtube_username,
            display_name: p.display_name,
            position: startPosition + index,
            source: p.source,
          }))
        )

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 })
        }

        const { error: deleteError } = await supabase
          .from('participants')
          .delete()
          .in(
            'id',
            rotatedParticipants.map((p) => p.id)
          )

        if (deleteError) {
          return NextResponse.json({ error: deleteError.message }, { status: 500 })
        }
      }

      const partyCountAfterRotation = Math.max(0, participantsAfterNextLastRemoval.length - rotatedParticipants.length)
      const desiredPromoteCount = Math.max(0, room.party_size - partyCountAfterRotation)

      if (desiredPromoteCount > 0) {
        const { data: promoteCandidates, error: promoteError } = await supabase
          .from('waiting_queue')
          .select('*')
          .eq('room_id', id)
          .order('position', { ascending: true })
          .limit(desiredPromoteCount)

        if (promoteError) {
          return NextResponse.json({ error: promoteError.message }, { status: 500 })
        }

        const promoteRows = promoteCandidates || []
        for (const q of promoteRows) {
          promoted.push(q.youtube_username)
        }

        if (promoteRows.length > 0) {
          const { error: insertError } = await supabase.from('participants').insert(
            promoteRows.map((q) => ({
              room_id: id,
              youtube_username: q.youtube_username,
              display_name: q.display_name,
              source: q.source,
            }))
          )

          if (insertError) {
            return NextResponse.json({ error: insertError.message }, { status: 500 })
          }

          const { error: deleteError } = await supabase
            .from('waiting_queue')
            .delete()
            .in(
              'id',
              promoteRows.map((q) => q.id)
            )

          if (deleteError) {
            return NextResponse.json({ error: deleteError.message }, { status: 500 })
          }
        }
      }

      const removedNextLastUsernames = uniqStrings([...removed_next_last_party, ...removed_next_last_queue])
      if (removedNextLastUsernames.length > 0) {
        const { error } = await supabase
          .from('room_next_last')
          .delete()
          .eq('room_id', id)
          .in('youtube_username', removedNextLastUsernames)

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      }
    }

    const changed =
      removed_next_last_party.length > 0 ||
      removed_next_last_queue.length > 0 ||
      rotated_regular.length > 0 ||
      promoted.length > 0

    if (!changed) {
      return NextResponse.json({ error: '交代できる対象がありません' }, { status: 400 })
    }

    const { error: normalizeError } = await supabase.rpc('renormalize_queue_positions', {
      p_room_id: id,
    })
    if (normalizeError) {
      return NextResponse.json({ error: normalizeError.message }, { status: 500 })
    }

    const { data: newVersion, error: bumpError } = await supabase.rpc('bump_room_order_version', {
      p_room_id: id,
    })

    if (bumpError) {
      return NextResponse.json({ error: bumpError.message }, { status: 500 })
    }

    const { data: freshRoom, error: freshRoomError } = await supabase
      .from('rooms')
      .select('id, party_size, rotate_count, is_monitoring, order_version')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (freshRoomError) {
      return NextResponse.json({ error: freshRoomError.message }, { status: 500 })
    }

    if (!freshRoom) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    // Use returned version if provided
    if (typeof newVersion === 'number') {
      freshRoom.order_version = newVersion
    }

    const { data: finalParticipants, error: finalParticipantsError } = await supabase
      .from('participants')
      .select('*')
      .eq('room_id', id)
      .order('position', { ascending: true })
      .order('joined_at', { ascending: true })

    if (finalParticipantsError) {
      return NextResponse.json({ error: finalParticipantsError.message }, { status: 500 })
    }

    const { data: finalQueue, error: finalQueueError } = await supabase
      .from('waiting_queue')
      .select('*')
      .eq('room_id', id)
      .order('position', { ascending: true })

    if (finalQueueError) {
      return NextResponse.json({ error: finalQueueError.message }, { status: 500 })
    }

    const { data: finalNextLastReservations, error: finalNextLastError } = await supabase
      .from('room_next_last')
      .select('youtube_username')
      .eq('room_id', id)

    if (finalNextLastError) {
      return NextResponse.json({ error: finalNextLastError.message }, { status: 500 })
    }

    const finalNextLastSet = new Set(
      (finalNextLastReservations || []).map((reservation) => reservation.youtube_username)
    )

    const participantsWithFlags = (finalParticipants || []).map((participant) => ({
      ...participant,
      is_next_last: finalNextLastSet.has(participant.youtube_username),
    }))

    const queueWithFlags = (finalQueue || []).map((queueMember) => ({
      ...queueMember,
      is_next_last: finalNextLastSet.has(queueMember.youtube_username),
    }))

    const party_shortage = Math.max(0, freshRoom.party_size - participantsWithFlags.length)

    let message = '交代しました'
    if (freshRoom.is_monitoring) {
      const removedTotal = removed_next_last_party.length + removed_next_last_queue.length
      message =
        removedTotal > 0
          ? `次ラスト${removedTotal}人を削除し、交代しました`
          : `交代しました`
    } else {
      message = `${rotated_regular.length}人を交代しました`
    }

    if (party_shortage > 0) {
      message += `（不足 ${party_shortage}人）`
    }

    return NextResponse.json({
      message,
      room: freshRoom,
      participants: participantsWithFlags,
      queue: queueWithFlags,
      removed_next_last_party,
      removed_next_last_queue,
      rotated_regular,
      promoted,
      party_shortage,
    })
  } catch (err) {
    console.error('Failed to rotate:', err)
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
