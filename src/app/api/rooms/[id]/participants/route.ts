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

    const { data: participants, error } = await supabase
      .from('participants')
      .select('*')
      .eq('room_id', id)
      .order('joined_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ participants })
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

    // Verify room ownership and get party_size
    const { data: room } = await supabase
      .from('rooms')
      .select('id, party_size')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!room) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    // Check current participant count
    const { count } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id)

    if (count !== null && count >= room.party_size) {
      return NextResponse.json({ error: 'パーティーが満員です' }, { status: 400 })
    }

    const body = await request.json()
    const { youtube_username, display_name, source = 'manual' } = body

    if (!youtube_username) {
      return NextResponse.json({ error: 'ユーザー名は必須です' }, { status: 400 })
    }

    const { data: participant, error } = await supabase
      .from('participants')
      .insert({
        room_id: id,
        youtube_username,
        display_name: display_name || youtube_username,
        source,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'このユーザーは既に参加しています' }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ participant }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
