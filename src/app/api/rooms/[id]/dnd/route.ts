import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'

type DndList = 'party' | 'queue'

type DndEdge = 'before' | 'after' | 'empty'

type DndMode = 'insert' | 'swap'

type DndOp = {
  source: {
    list: DndList
    id: string
  }
  dest: {
    list: DndList
    overId: string | null
    edge: DndEdge
  }
  mode: DndMode
}

type ApplyDndInput = {
  partyUsernames: string[]
  queueUsernames: string[]
  partySize: number
  op: DndOp
}

type ApplyDndOutput = {
  desiredPartyUsernames: string[]
  desiredQueueUsernames: string[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    return `{${entries.join(',')}}`
  }

  return 'null'
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function normalizePartyAndQueue(
  partyUsernames: string[],
  queueUsernames: string[],
  partySize: number
): void {
  while (partyUsernames.length > partySize) {
    const demoted = partyUsernames.shift()
    if (demoted) queueUsernames.push(demoted)
  }

  while (partyUsernames.length < partySize && queueUsernames.length > 0) {
    const promoted = queueUsernames.shift()
    if (promoted) partyUsernames.push(promoted)
  }
}

function applyDnd(input: ApplyDndInput): ApplyDndOutput {
  const partyUsernames = [...input.partyUsernames]
  const queueUsernames = [...input.queueUsernames]
  const partySize = input.partySize
  const op = input.op

  const sourceId = op.source.id.trim()
  const destOverId = op.dest.overId === null ? null : op.dest.overId.trim()

  if (!sourceId) {
    throw new Error('Invalid op.source.id')
  }

  if (op.source.list === op.dest.list && op.mode === 'swap') {
    throw new Error('Swap within same list is not allowed')
  }

  if (op.source.list === op.dest.list && destOverId === sourceId) {
    return {
      desiredPartyUsernames: partyUsernames,
      desiredQueueUsernames: queueUsernames,
    }
  }

  const sourcePartyIndex = partyUsernames.indexOf(sourceId)
  const sourceQueueIndex = queueUsernames.indexOf(sourceId)

  if (op.source.list === 'party' && sourcePartyIndex === -1) {
    throw new Error('Invalid op.source.id')
  }

  if (op.source.list === 'queue' && sourceQueueIndex === -1) {
    throw new Error('Invalid op.source.id')
  }

  if (op.mode === 'swap') {
    if (op.source.list !== 'queue' || op.dest.list !== 'party' || destOverId === null) {
      throw new Error('Invalid op (swap)')
    }

    const partyOverIndex = partyUsernames.indexOf(destOverId)
    if (partyOverIndex === -1) {
      throw new Error('Invalid op.dest.overId')
    }

    // Swap membership AND positions:
    // - source queue member takes the party member's position
    // - displaced party member goes to the source queue member's original position
    partyUsernames[partyOverIndex] = sourceId
    queueUsernames[sourceQueueIndex] = destOverId

    return {
      desiredPartyUsernames: partyUsernames,
      desiredQueueUsernames: queueUsernames,
    }
  }

  // mode: insert
  if (op.source.list === 'party') {
    partyUsernames.splice(sourcePartyIndex, 1)
  } else {
    queueUsernames.splice(sourceQueueIndex, 1)
  }

  if (op.dest.overId === null) {
    if (op.dest.edge !== 'empty') {
      throw new Error('Invalid drop target')
    }

    if (op.dest.list === 'party') {
      partyUsernames.push(sourceId)

      if (op.source.list !== op.dest.list) {
        normalizePartyAndQueue(partyUsernames, queueUsernames, partySize)
      }

      return {
        desiredPartyUsernames: partyUsernames,
        desiredQueueUsernames: queueUsernames,
      }
    }

    if (op.dest.list === 'queue') {
      queueUsernames.push(sourceId)

      if (op.source.list !== op.dest.list) {
        normalizePartyAndQueue(partyUsernames, queueUsernames, partySize)
      }

      return {
        desiredPartyUsernames: partyUsernames,
        desiredQueueUsernames: queueUsernames,
      }
    }

    throw new Error('Invalid drop target')
  }

  if (op.dest.edge === 'empty') {
    throw new Error('Invalid drop target')
  }

  if (destOverId === null) {
    throw new Error('Invalid op.dest.overId')
  }

  const destArray = op.dest.list === 'party' ? partyUsernames : queueUsernames
  const overIndex = destArray.indexOf(destOverId)

  if (overIndex === -1) {
    throw new Error('Invalid op.dest.overId')
  }

  const insertIndex = op.dest.edge === 'before' ? overIndex : overIndex + 1
  destArray.splice(insertIndex, 0, sourceId)

  if (op.source.list !== op.dest.list) {
    normalizePartyAndQueue(partyUsernames, queueUsernames, partySize)
  }

  return {
    desiredPartyUsernames: partyUsernames,
    desiredQueueUsernames: queueUsernames,
  }
}

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

    const expectedVersion = body?.expected_version
    const clientOpId = body?.client_op_id
    const op = body?.op

    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return NextResponse.json({ error: 'expected_version is required' }, { status: 400 })
    }

    if (!isNonEmptyString(clientOpId) || !isUuidLike(clientOpId.trim())) {
      return NextResponse.json({ error: 'client_op_id must be a UUID' }, { status: 400 })
    }

    if (
      !op ||
      !op.source ||
      !op.dest ||
      (op.source.list !== 'party' && op.source.list !== 'queue') ||
      !isNonEmptyString(op.source.id) ||
      (op.dest.list !== 'party' && op.dest.list !== 'queue') ||
      (op.dest.edge !== 'before' && op.dest.edge !== 'after' && op.dest.edge !== 'empty') ||
      !(op.dest.overId === null || typeof op.dest.overId === 'string') ||
      (op.mode !== 'insert' && op.mode !== 'swap')
    ) {
      return NextResponse.json({ error: 'Invalid op' }, { status: 400 })
    }

    const normalizedOp: DndOp = {
      source: {
        list: op.source.list,
        id: op.source.id.trim(),
      },
      dest: {
        list: op.dest.list,
        overId: op.dest.overId === null ? null : op.dest.overId.trim(),
        edge: op.dest.edge,
      },
      mode: op.mode,
    }

    if (!normalizedOp.source.id) {
      return NextResponse.json({ error: 'Invalid op.source.id' }, { status: 400 })
    }

    if (normalizedOp.dest.overId !== null && !normalizedOp.dest.overId) {
      return NextResponse.json({ error: 'Invalid op.dest.overId' }, { status: 400 })
    }

    if (normalizedOp.dest.overId === null) {
      if (normalizedOp.dest.edge !== 'empty') {
        return NextResponse.json({ error: 'Invalid drop target' }, { status: 400 })
      }
    } else {
      if (normalizedOp.dest.edge === 'empty') {
        return NextResponse.json({ error: 'Invalid drop target' }, { status: 400 })
      }
    }

    if (normalizedOp.source.list === normalizedOp.dest.list && normalizedOp.mode !== 'insert') {
      return NextResponse.json(
        { error: 'Swap within same list is not allowed' },
        { status: 400 }
      )
    }

    if (normalizedOp.mode === 'swap') {
      if (
        normalizedOp.source.list !== 'queue' ||
        normalizedOp.dest.list !== 'party' ||
        normalizedOp.dest.overId === null
      ) {
        return NextResponse.json({ error: 'Invalid op (swap)' }, { status: 400 })
      }
    }

    const opHash = sha256Hex(stableStringify(normalizedOp))

    const { data: room } = await supabase
      .from('rooms')
      .select('id, party_size, order_version')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!room) {
      return NextResponse.json({ error: 'ルームが見つかりません' }, { status: 404 })
    }

    const { data: participants, error: participantsError } = await supabase
      .from('participants')
      .select('id,youtube_username,display_name,position,joined_at,source')
      .eq('room_id', id)
      .order('position', { ascending: true })
      .order('joined_at', { ascending: true })

    if (participantsError) {
      return NextResponse.json({ error: participantsError.message }, { status: 500 })
    }

    const { data: queue, error: queueError } = await supabase
      .from('waiting_queue')
      .select('id,youtube_username,display_name,position,registered_at,source')
      .eq('room_id', id)
      .order('position', { ascending: true })

    if (queueError) {
      return NextResponse.json({ error: queueError.message }, { status: 500 })
    }

    const partyUsernames = (participants || []).map((p) => String(p.youtube_username))
    const queueUsernames = (queue || []).map((q) => String(q.youtube_username))

    if (normalizedOp.source.list === 'party' && !partyUsernames.includes(normalizedOp.source.id)) {
      return NextResponse.json({ error: 'Invalid op.source.id' }, { status: 400 })
    }

    if (normalizedOp.source.list === 'queue' && !queueUsernames.includes(normalizedOp.source.id)) {
      return NextResponse.json({ error: 'Invalid op.source.id' }, { status: 400 })
    }

    if (normalizedOp.dest.overId !== null) {
      const destList = normalizedOp.dest.list === 'party' ? partyUsernames : queueUsernames
      if (!destList.includes(normalizedOp.dest.overId)) {
        return NextResponse.json({ error: 'Invalid op.dest.overId' }, { status: 400 })
      }
    }

    let desiredPartyUsernames: string[]
    let desiredQueueUsernames: string[]

    try {
      const applied = applyDnd({
        partyUsernames,
        queueUsernames,
        partySize: room.party_size,
        op: normalizedOp,
      })

      desiredPartyUsernames = applied.desiredPartyUsernames
      desiredQueueUsernames = applied.desiredQueueUsernames
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid op'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc('apply_room_dnd_order', {
      p_room_id: id,
      p_expected_version: expectedVersion,
      p_client_op_id: clientOpId.trim(),
      p_desired_party_usernames: desiredPartyUsernames,
      p_desired_queue_usernames: desiredQueueUsernames,
      p_op_hash: opHash,
    })

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }

    const status = rpcResult?.status as
      | 'ok'
      | 'replay'
      | 'version_conflict'
      | 'reject'
      | 'op_id_mismatch'
      | undefined

    const responseBody = {
      status: status ?? 'reject',
      version: rpcResult?.version ?? room.order_version,
      participants: rpcResult?.participants ?? [],
      queue: rpcResult?.queue ?? [],
    }

    if (status === 'version_conflict' || status === 'op_id_mismatch') {
      return NextResponse.json(responseBody, { status: 409 })
    }

    if (status === 'reject') {
      return NextResponse.json(responseBody, { status: 400 })
    }

    return NextResponse.json(responseBody, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
