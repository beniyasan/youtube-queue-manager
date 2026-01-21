import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getLiveChatId } from '@/lib/youtubeApi'

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

    if (!room.youtube_video_id) {
      return NextResponse.json({ error: 'YouTube URLが設定されていません' }, { status: 400 })
    }

    // Get live chat ID
    const liveChatId = await getLiveChatId(room.youtube_video_id)
    
    if (!liveChatId) {
      return NextResponse.json({ 
        error: 'ライブチャットが見つかりません。配信中のURLを設定してください。' 
      }, { status: 400 })
    }

    // Update room
    const { error } = await supabase
      .from('rooms')
      .update({
        is_monitoring: true,
        youtube_live_chat_id: liveChatId,
        youtube_next_page_token: null,
        last_comment_id: null,
        youtube_next_poll_at: null,
        youtube_poller_lease_id: null,
        youtube_poller_lease_until: null,
        youtube_polling_interval_ms: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ 
      message: 'YouTube監視を開始しました',
      liveChatId,
    })
  } catch (err) {
    console.error('Failed to start monitoring:', err)
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
