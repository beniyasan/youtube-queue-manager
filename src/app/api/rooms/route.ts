import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { extractVideoId } from '@/lib/youtube'

export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }

    const { data: rooms, error } = await supabase
      .from('rooms')
      .select(`
        *,
        participants:participants(count),
        waiting_queue:waiting_queue(count)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ rooms })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }

    const body = await request.json()
    const { name, youtube_url, keyword, party_size, rotate_count } = body

    if (!name) {
      return NextResponse.json({ error: 'ルーム名は必須です' }, { status: 400 })
    }

    const youtube_video_id = youtube_url ? extractVideoId(youtube_url) : null

    const { data: room, error } = await supabase
      .from('rooms')
      .insert({
        user_id: user.id,
        name,
        youtube_url: youtube_url || null,
        youtube_video_id,
        keyword: keyword || '参加',
        party_size: party_size || 4,
        rotate_count: rotate_count || 1,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ room }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
