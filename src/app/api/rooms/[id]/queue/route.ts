import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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

    // Verify room ownership
    const { data: room } = await supabase
      .from('rooms')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!room) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    const { data: queue, error } = await supabase
      .from('waiting_queue')
      .select('*')
      .eq('room_id', id)
      .order('position', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ queue })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}

export async function POST(
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

    // Verify room ownership
    const { data: room } = await supabase
      .from('rooms')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!room) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    const body = await request.json()
    const { youtube_username, display_name, source = 'manual' } = body

    if (!youtube_username) {
      return NextResponse.json({ error: 'ユーザー名は必須です' }, { status: 400 })
    }

    // Get next position
    const { data: lastInQueue } = await supabase
      .from('waiting_queue')
      .select('position')
      .eq('room_id', id)
      .order('position', { ascending: false })
      .limit(1)
      .single()

    const nextPosition = lastInQueue ? lastInQueue.position + 1 : 0

    const { data: queueMember, error } = await supabase
      .from('waiting_queue')
      .insert({
        room_id: id,
        youtube_username,
        display_name: display_name || youtube_username,
        position: nextPosition,
        source,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'このユーザーは既に登録されています' }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { error: bumpError } = await supabase.rpc('bump_room_order_version', {
      p_room_id: id,
    })

    if (bumpError) {
      return NextResponse.json({ error: bumpError.message }, { status: 500 })
    }

    return NextResponse.json({ queueMember }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
