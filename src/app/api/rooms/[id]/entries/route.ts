import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const youtubeUsernameRaw = body?.youtube_username
    const displayNameRaw = body?.display_name

    const youtubeUsername =
      typeof youtubeUsernameRaw === 'string' ? youtubeUsernameRaw.trim() : ''
    const displayName =
      typeof displayNameRaw === 'string' ? displayNameRaw.trim() : ''

    if (!youtubeUsername) {
      return NextResponse.json({ error: 'ユーザー名は必須です' }, { status: 400 })
    }

    const { data: room } = await supabase
      .from('rooms')
      .select('id, party_size')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!room) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    const { data: participantHit, error: participantHitError } = await supabase
      .from('participants')
      .select('id')
      .eq('room_id', id)
      .eq('youtube_username', youtubeUsername)
      .limit(1)

    if (participantHitError) {
      return NextResponse.json({ error: participantHitError.message }, { status: 500 })
    }

    if (participantHit && participantHit.length > 0) {
      return NextResponse.json({
        status: 'already_exists',
        destination: 'participant',
        message: '既に参加しています',
      })
    }

    const { data: queueHit, error: queueHitError } = await supabase
      .from('waiting_queue')
      .select('id')
      .eq('room_id', id)
      .eq('youtube_username', youtubeUsername)
      .limit(1)

    if (queueHitError) {
      return NextResponse.json({ error: queueHitError.message }, { status: 500 })
    }

    if (queueHit && queueHit.length > 0) {
      return NextResponse.json({
        status: 'already_exists',
        destination: 'queue',
        message: '既に待機リストにいます',
      })
    }

    const { count: participantCount, error: participantCountError } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id)

    if (participantCountError) {
      return NextResponse.json({ error: participantCountError.message }, { status: 500 })
    }

    const finalDisplayName = displayName || youtubeUsername

    if ((participantCount ?? 0) < room.party_size) {
      const { data: participant, error: insertError } = await supabase
        .from('participants')
        .insert({
          room_id: id,
          youtube_username: youtubeUsername,
          display_name: finalDisplayName,
          source: 'manual',
        })
        .select()
        .single()

      if (insertError) {
        if (insertError.code === '23505') {
          return NextResponse.json({
            status: 'already_exists',
            destination: 'participant',
            message: '既に参加しています',
          })
        }
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }

      return NextResponse.json(
        {
          status: 'created',
          destination: 'participant',
          message: '参加者に追加しました',
          entry: participant,
        },
        { status: 201 }
      )
    }

    const { data: lastInQueue, error: lastInQueueError } = await supabase
      .from('waiting_queue')
      .select('position')
      .eq('room_id', id)
      .order('position', { ascending: false })
      .limit(1)

    if (lastInQueueError) {
      return NextResponse.json({ error: lastInQueueError.message }, { status: 500 })
    }

    const nextPosition = (lastInQueue?.[0]?.position ?? 0) + 1

    const { data: queueMember, error: queueInsertError } = await supabase
      .from('waiting_queue')
      .insert({
        room_id: id,
        youtube_username: youtubeUsername,
        display_name: finalDisplayName,
        position: nextPosition,
        source: 'manual',
      })
      .select()
      .single()

    if (queueInsertError) {
      if (queueInsertError.code === '23505') {
        return NextResponse.json({
          status: 'already_exists',
          destination: 'queue',
          message: '既に待機リストにいます',
        })
      }
      return NextResponse.json({ error: queueInsertError.message }, { status: 500 })
    }

    return NextResponse.json(
      {
        status: 'created',
        destination: 'queue',
        message: '待機リストに追加しました',
        entry: queueMember,
      },
      { status: 201 }
    )
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
