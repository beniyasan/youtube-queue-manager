import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getLiveChatId, getLiveChatMessages, filterMessagesByKeyword } from '@/lib/youtubeApi'

function clampMs(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function parseTimeMs(value: string | null | undefined) {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function toIso(date: Date) {
  return date.toISOString()
}

export async function GET(
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

    const url = new URL(request.url)
    const pollerId = request.headers.get('x-poller-id') ?? url.searchParams.get('pollerId')
    if (!pollerId) {
      return NextResponse.json({ error: 'pollerId が必要です' }, { status: 400 })
    }

    // Validate ownership + current state
    const { data: room } = await supabase
      .from('rooms')
      .select('id,user_id,is_monitoring,youtube_video_id,youtube_live_chat_id,youtube_next_page_token,last_comment_id,keyword,next_last_keyword,party_size,youtube_next_poll_at,youtube_poller_lease_id,youtube_poller_lease_until,youtube_polling_interval_ms')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!room) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    if (!room.is_monitoring) {
      return NextResponse.json({
        message: '監視が停止しています',
        added: [],
        next_last_usernames: [],
        next_last_updated: false,
        isMonitoring: false,
        retry_after_ms: null,
      })
    }

    if (!room.youtube_video_id) {
      return NextResponse.json({ error: 'YouTube URLが設定されていません' }, { status: 400 })
    }

    const now = new Date()
    const nowIso = toIso(now)
    const nowMs = now.getTime()

    // Acquire/renew short-term lease (single poller per room)
    const leaseDurationMs = 30_000
    const leaseUntilIso = toIso(new Date(nowMs + leaseDurationMs))

    const { data: leasedRooms, error: leaseError } = await supabase
      .from('rooms')
      .update({
        youtube_poller_lease_id: pollerId,
        youtube_poller_lease_until: leaseUntilIso,
        updated_at: nowIso,
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .or(
        [
          'youtube_poller_lease_until.is.null',
          `youtube_poller_lease_until.lte.${nowIso}`,
          `youtube_poller_lease_id.eq.${pollerId}`,
        ].join(',')
      )
      .select('youtube_next_poll_at,youtube_poller_lease_id,youtube_poller_lease_until,youtube_next_page_token,youtube_live_chat_id,last_comment_id,youtube_polling_interval_ms,keyword,next_last_keyword,party_size,youtube_video_id,is_monitoring')

    if (leaseError) {
      return NextResponse.json({ error: leaseError.message }, { status: 500 })
    }

    if (!leasedRooms || leasedRooms.length === 0) {
      const { data: current } = await supabase
        .from('rooms')
        .select('youtube_poller_lease_until,youtube_next_poll_at,youtube_polling_interval_ms')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      const leaseUntilMs = parseTimeMs(current?.youtube_poller_lease_until)
      const nextPollAtMs = parseTimeMs(current?.youtube_next_poll_at)

      const leaseWait = leaseUntilMs ? leaseUntilMs - nowMs : 1000
      const throttleWait = nextPollAtMs && nextPollAtMs > nowMs ? nextPollAtMs - nowMs : 0
      const retryAfter = clampMs(Math.max(leaseWait, throttleWait, 250), 250, 30_000)

      return NextResponse.json(
        {
          error: '別のポーラーが実行中です',
          retry_after_ms: retryAfter,
          next_poll_at: current?.youtube_next_poll_at ?? null,
          pollingIntervalMillis: current?.youtube_polling_interval_ms ?? null,
          pollingIntervalMs: current?.youtube_polling_interval_ms ?? null,
          next_last_usernames: [],
          next_last_updated: false,
        },
        { status: 409 }
      )
    }

    const leasedRoom = leasedRooms[0]

    // Enforce server-side throttle
    const nextPollAtMs = parseTimeMs(leasedRoom.youtube_next_poll_at)
    if (nextPollAtMs && nowMs < nextPollAtMs) {
      const retryAfter = clampMs(nextPollAtMs - nowMs, 250, 60_000)
      return NextResponse.json({
        message: 'ポーリングをスキップしました',
        skipped: true,
        added: [],
        next_last_usernames: [],
        next_last_updated: false,
        totalMessages: 0,
        newMessages: 0,
        isMonitoring: true,
        nextPageToken: leasedRoom.youtube_next_page_token ?? null,
        pollingIntervalMillis: leasedRoom.youtube_polling_interval_ms ?? null,
        pollingIntervalMs: leasedRoom.youtube_polling_interval_ms ?? null,
        retry_after_ms: retryAfter,
        next_poll_at: leasedRoom.youtube_next_poll_at,
      })
    }

    const liveChatId = leasedRoom.youtube_live_chat_id
      ? leasedRoom.youtube_live_chat_id
      : await getLiveChatId(leasedRoom.youtube_video_id)

    if (!liveChatId) {
      const { error: stopError } = await supabase
        .from('rooms')
        .update({
          is_monitoring: false,
          youtube_live_chat_id: null,
          youtube_next_page_token: null,
          youtube_next_poll_at: null,
          youtube_poller_lease_id: null,
          youtube_poller_lease_until: null,
          youtube_polling_interval_ms: null,
          updated_at: nowIso,
        })
        .eq('id', id)
        .eq('user_id', user.id)

      if (stopError) {
        return NextResponse.json({ error: stopError.message }, { status: 500 })
      }

      const { error: clearNextLastError } = await supabase
        .from('room_next_last')
        .delete()
        .eq('room_id', id)

      if (clearNextLastError) {
        return NextResponse.json({ error: clearNextLastError.message }, { status: 500 })
      }

      return NextResponse.json({
        message: 'ライブチャットが終了しました',
        added: [],
        next_last_usernames: [],
        next_last_updated: false,
        isMonitoring: false,
        retry_after_ms: null,
      })
    }

    const { messages, nextPageToken, pollingIntervalMs } = await getLiveChatMessages(
      liveChatId,
      leasedRoom.youtube_next_page_token || undefined
    )

    const ytInterval = clampMs(pollingIntervalMs || 10_000, 1_000, 5 * 60_000)
    const nextPollAtIso = toIso(new Date(nowMs + ytInterval))

    const newMessages = filterMessagesByKeyword(messages, leasedRoom.keyword)

    const nextLastKeyword =
      typeof leasedRoom.next_last_keyword === 'string' && leasedRoom.next_last_keyword.trim()
        ? leasedRoom.next_last_keyword.trim()
        : null

    const nextLastMessages = nextLastKeyword
      ? filterMessagesByKeyword(messages, nextLastKeyword)
      : []

    const { count: participantCount } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id)

    const { data: existingParticipants } = await supabase
      .from('participants')
      .select('youtube_username')
      .eq('room_id', id)

    const { data: existingQueue } = await supabase
      .from('waiting_queue')
      .select('youtube_username')
      .eq('room_id', id)

    const membershipUsernames = new Set([
      ...(existingParticipants || []).map((p) => p.youtube_username),
      ...(existingQueue || []).map((q) => q.youtube_username),
    ])

    const nextLastUsernamesToUpsert = Array.from(
      new Set(
        nextLastMessages
          .map((msg) => msg.authorDisplayName)
          .filter((username) => membershipUsernames.has(username))
      )
    )

    let nextLastUsernames: string[] = []
    let nextLastUpdated = false

    if (nextLastUsernamesToUpsert.length > 0) {
      const { error: nextLastError } = await supabase
        .from('room_next_last')
        .upsert(
          nextLastUsernamesToUpsert.map((youtube_username) => ({
            room_id: id,
            youtube_username,
            reserved_at: nowIso,
          })),
          { onConflict: 'room_id,youtube_username' }
        )

      if (nextLastError) {
        return NextResponse.json({ error: nextLastError.message }, { status: 500 })
      }

      nextLastUsernames = nextLastUsernamesToUpsert
      nextLastUpdated = true
    }

    const existingUsernames = new Set(membershipUsernames)

    const added: { username: string; destination: 'participant' | 'queue' }[] = []
    let currentParticipantCount = participantCount || 0

    const { data: lastInQueue } = await supabase
      .from('waiting_queue')
      .select('position')
      .eq('room_id', id)
      .order('position', { ascending: false })
      .limit(1)
      .single()

    let nextPosition = lastInQueue ? lastInQueue.position + 1 : 0

    for (const msg of newMessages) {
      if (existingUsernames.has(msg.authorDisplayName)) {
        continue
      }

      if (currentParticipantCount < leasedRoom.party_size) {
        const { error } = await supabase
          .from('participants')
          .insert({
            room_id: id,
            youtube_username: msg.authorDisplayName,
            display_name: msg.authorDisplayName,
            source: 'youtube',
          })

        if (!error) {
          added.push({ username: msg.authorDisplayName, destination: 'participant' })
          existingUsernames.add(msg.authorDisplayName)
          currentParticipantCount++
        }
      } else {
        const { error } = await supabase
          .from('waiting_queue')
          .insert({
            room_id: id,
            youtube_username: msg.authorDisplayName,
            display_name: msg.authorDisplayName,
            position: nextPosition,
            source: 'youtube',
          })

        if (!error) {
          added.push({ username: msg.authorDisplayName, destination: 'queue' })
          existingUsernames.add(msg.authorDisplayName)
          nextPosition++
        }
      }
    }

    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null

    await supabase
      .from('rooms')
      .update({
        youtube_live_chat_id: liveChatId,
        youtube_next_page_token: nextPageToken,
        last_comment_id: lastMessage?.id ?? leasedRoom.last_comment_id,
        youtube_polling_interval_ms: ytInterval,
        youtube_next_poll_at: nextPollAtIso,
        updated_at: nowIso,
      })
      .eq('id', id)
      .eq('user_id', user.id)

    if (added.length > 0) {
      const { error: bumpError } = await supabase.rpc('bump_room_order_version', {
        p_room_id: id,
      })

      if (bumpError) {
        return NextResponse.json({ error: bumpError.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      message: 'ポーリング完了',
      added,
      next_last_usernames: nextLastUsernames,
      next_last_updated: nextLastUpdated,
      totalMessages: messages.length,
      newMessages: newMessages.length,
      isMonitoring: true,
      nextPageToken,
      pollingIntervalMillis: ytInterval,
      pollingIntervalMs: ytInterval,
      retry_after_ms: ytInterval,
      next_poll_at: nextPollAtIso,
    })
  } catch (err) {
    console.error('Failed to poll:', err)
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
