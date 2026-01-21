import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; queueId: string }> }
) {
  try {
    const { id, queueId } = await params
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

    // Get the position of the item to be deleted
    const { data: deletedItem } = await supabase
      .from('waiting_queue')
      .select('position')
      .eq('id', queueId)
      .single()

    if (!deletedItem) {
      return NextResponse.json({ error: '待機者が見つかりません' }, { status: 404 })
    }

    // Delete the item
    const { data: deletedItems, error: deleteError } = await supabase
      .from('waiting_queue')
      .delete()
      .eq('id', queueId)
      .eq('room_id', id)
      .select('id')

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    if (!deletedItems || deletedItems.length == 0) {
      return NextResponse.json({ error: '待機者が見つかりません' }, { status: 404 })
    }

    // Reorder positions
    const { data: remainingQueue } = await supabase
      .from('waiting_queue')
      .select('id, position')
      .eq('room_id', id)
      .gt('position', deletedItem.position)
      .order('position', { ascending: true })

    if (remainingQueue && remainingQueue.length > 0) {
      for (const item of remainingQueue) {
        const { error: updateError } = await supabase
          .from('waiting_queue')
          .update({ position: item.position - 1 })
          .eq('id', item.id)

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 })
        }
      }
    }

    const { error: bumpError } = await supabase.rpc('bump_room_order_version', {
      p_room_id: id,
    })

    if (bumpError) {
      return NextResponse.json({ error: bumpError.message }, { status: 500 })
    }

    return NextResponse.json({ message: '待機者を削除しました' })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
