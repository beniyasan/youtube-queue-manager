import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getLiveChatId, getLiveChatMessages, filterMessagesByKeyword } from '@/lib/youtubeApi'

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

    // Get room
    const { data: room } = await supabase
      .from('rooms')
      .select('*')
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
        isMonitoring: false,
      })
    }

    if (!room.youtube_video_id) {
      return NextResponse.json({ error: 'YouTube URLが設定されていません' }, { status: 400 })
    }

    const liveChatId = room.youtube_live_chat_id
      ? room.youtube_live_chat_id
      : await getLiveChatId(room.youtube_video_id)

    if (!liveChatId) {
      // Stop monitoring if live chat is not available
      await supabase
        .from('rooms')
        .update({
          is_monitoring: false,
          youtube_live_chat_id: null,
          youtube_next_page_token: null,
        })
        .eq('id', id)
        .eq('user_id', user.id)
        
      return NextResponse.json({ 
        message: 'ライブチャットが終了しました',
        added: [],
        isMonitoring: false,
      })
    }

    // Get messages
    const { messages, nextPageToken } = await getLiveChatMessages(
      liveChatId,
      room.youtube_next_page_token || undefined
    )

    // Filter by keyword
    const newMessages = filterMessagesByKeyword(messages, room.keyword)

    // Get current participant count
    const { count: participantCount } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id)

    // Get existing usernames
    const { data: existingParticipants } = await supabase
      .from('participants')
      .select('youtube_username')
      .eq('room_id', id)

    const { data: existingQueue } = await supabase
      .from('waiting_queue')
      .select('youtube_username')
      .eq('room_id', id)

    const existingUsernames = new Set([
      ...(existingParticipants || []).map(p => p.youtube_username),
      ...(existingQueue || []).map(q => q.youtube_username),
    ])

    // Add new users
    const added: { username: string; destination: 'participant' | 'queue' }[] = []
    let currentParticipantCount = participantCount || 0

    // Get current max queue position
    const { data: lastInQueue } = await supabase
      .from('waiting_queue')
      .select('position')
      .eq('room_id', id)
      .order('position', { ascending: false })
      .limit(1)
      .single()

    let nextPosition = lastInQueue ? lastInQueue.position + 1 : 1

    for (const msg of newMessages) {
      if (existingUsernames.has(msg.authorDisplayName)) {
        continue
      }

      if (currentParticipantCount < room.party_size) {
        // Add to participants
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
        // Add to queue
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

    // Update polling state
    if (messages.length > 0 || nextPageToken) {
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
      await supabase
        .from('rooms')
        .update({
          youtube_live_chat_id: liveChatId,
          youtube_next_page_token: nextPageToken,
          last_comment_id: lastMessage?.id ?? room.last_comment_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ 
      message: 'ポーリング完了',
      added,
      totalMessages: messages.length,
      newMessages: newMessages.length,
      isMonitoring: true,
      nextPageToken,
    })
  } catch (err) {
    console.error('Failed to poll:', err)
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
