import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; participantId: string }> }
) {
  try {
    const { id, participantId } = await params
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

    const { data: deletedParticipants, error } = await supabase
      .from('participants')
      .delete()
      .eq('id', participantId)
      .eq('room_id', id)
      .select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (deletedParticipants && deletedParticipants.length > 0) {
      const { error: bumpError } = await supabase.rpc('bump_room_order_version', {
        p_room_id: id,
      })

      if (bumpError) {
        return NextResponse.json({ error: bumpError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ message: '参加者を削除しました' })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
