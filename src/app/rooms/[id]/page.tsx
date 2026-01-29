'use client'

import { useAuth } from '@/hooks/useAuth'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Room {
  id: string
  name: string
  youtube_url: string | null
  youtube_video_id: string | null
  keyword: string
  party_size: number
  rotate_count: number
  is_monitoring: boolean
  order_version: number
}

interface Participant {
  id: string
  youtube_username: string
  display_name: string | null
  joined_at: string
  source: 'manual' | 'youtube'
  is_next_last: boolean
}

interface QueueMember {
  id: string
  youtube_username: string
  display_name: string | null
  position: number
  source: 'manual' | 'youtube'
  is_next_last: boolean
}

type PollResponse = {
  isMonitoring?: boolean
  added?: Array<{ username: string; destination?: 'participant' | 'queue' }>
  next_last_updated?: boolean
  next_last_usernames?: string[]
  pollingIntervalMillis?: number
  pollingIntervalMs?: number
  retry_after_ms?: number
  skipped?: boolean
  nextPageToken?: string | null
  next_poll_at?: string | null
  error?: string
}

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

type DropIndicator = {
  list: DndList
  overId: string | null
  edge: DndEdge
} | null

const PARTY_CONTAINER_ID = 'party'
const QUEUE_CONTAINER_ID = 'queue'

type ClientPoint = { x: number; y: number }

function getClientPoint(event: Event | null): ClientPoint | null {
  if (!event) return null

  if ('touches' in event) {
    const touchEvent = event as TouchEvent
    const firstTouch = touchEvent.touches?.[0]
    if (firstTouch) {
      return { x: firstTouch.clientX, y: firstTouch.clientY }
    }
  }

  if ('clientX' in event && 'clientY' in event) {
    const mouseEvent = event as MouseEvent
    return { x: mouseEvent.clientX, y: mouseEvent.clientY }
  }

  return null
}

function normalizeQueuePositions(queue: QueueMember[]): QueueMember[] {
  return queue.map((q, index) => ({ ...q, position: index }))
}

function makeTempParticipant(clientOpId: string, source: QueueMember): Participant {
  return {
    id: `temp-party-${clientOpId}-${source.youtube_username}`,
    youtube_username: source.youtube_username,
    display_name: source.display_name,
    joined_at: new Date().toISOString(),
    source: source.source,
    is_next_last: source.is_next_last,
  }
}

function makeTempQueueMember(
  clientOpId: string,
  source: Participant,
  position: number
): QueueMember {
  return {
    id: `temp-queue-${clientOpId}-${source.youtube_username}`,
    youtube_username: source.youtube_username,
    display_name: source.display_name,
    position,
    source: source.source,
    is_next_last: source.is_next_last,
  }
}

function normalizePartyAndQueueByPartySize(
  clientOpId: string,
  party: Participant[],
  queue: QueueMember[],
  partySize: number
): { party: Participant[]; queue: QueueMember[] } {
  const nextParty = [...party]
  const nextQueue = [...queue]

  while (nextParty.length > partySize) {
    const demoted = nextParty.shift()
    if (!demoted) break
    nextQueue.push(makeTempQueueMember(clientOpId, demoted, nextQueue.length))
  }

  while (nextParty.length < partySize && nextQueue.length > 0) {
    const promoted = nextQueue.shift()
    if (!promoted) break
    nextParty.push(makeTempParticipant(clientOpId, promoted))
  }

  return {
    party: nextParty,
    queue: normalizeQueuePositions(nextQueue),
  }
}

function SortableArcadeRow(props: {
  itemId: string
  list: DndList
  indexLabel: string
  accentVar: 'cyan' | 'yellow'
  name: string
  showYoutubeBadge?: boolean
  showNextLastBadge?: boolean
  onRemove?: () => void
  indicatorEdge?: Exclude<DndEdge, 'empty'> | null
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: props.itemId,
      data: { list: props.list },
    })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const accentColor =
    props.accentVar === 'cyan' ? 'var(--neon-cyan)' : 'var(--neon-yellow)'

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={
        'relative flex items-center justify-between bg-[var(--bg-secondary)] p-3 rounded border border-transparent transition-colors ' +
        (isDragging
          ? 'opacity-0 pointer-events-none'
          : 'hover:border-[var(--border-color)] hover:shadow-[0_0_0_1px_rgba(0,255,245,0.15)]')
      }
    >
      {props.indicatorEdge === 'before' && (
        <div className="absolute left-2 right-2 top-0 h-[2px] bg-[var(--neon-cyan)] opacity-90" />
      )}
      {props.indicatorEdge === 'after' && (
        <div className="absolute left-2 right-2 bottom-0 h-[2px] bg-[var(--neon-cyan)] opacity-90" />
      )}

      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...listeners}
          className="text-[var(--text-muted)] hover:text-[var(--neon-cyan)] cursor-grab active:cursor-grabbing select-none px-1"
          aria-label="Drag"
        >
          ⋮⋮
        </button>

        <span className="font-mono text-sm" style={{ color: accentColor }}>
          {props.indexLabel}
        </span>

        <span className="text-white truncate">{props.name}</span>

        {props.showYoutubeBadge && (
          <span className="text-xs bg-[var(--neon-magenta)]/20 text-[var(--neon-magenta)] px-1.5 py-0.5 rounded">
            YT
          </span>
        )}

        {props.showNextLastBadge && (
          <span className="text-xs bg-[var(--neon-orange)]/20 text-[var(--neon-orange)] px-1.5 py-0.5 rounded">
            次ラスト
          </span>
        )}
      </div>

      {props.onRemove && (
        <button
          type="button"
          onClick={props.onRemove}
          className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
          aria-label="Remove"
        >
          ×
        </button>
      )}
    </div>
  )
}

function DragOverlayRow(props: {
  indexLabel: string
  accentVar: 'cyan' | 'yellow'
  name: string
  showYoutubeBadge?: boolean
}) {
  const accentColor =
    props.accentVar === 'cyan' ? 'var(--neon-cyan)' : 'var(--neon-yellow)'

  return (
    <div className="flex items-center justify-between bg-[var(--bg-secondary)] p-3 rounded border border-[var(--border-color)] shadow-[0_0_20px_rgba(0,255,245,0.15)]">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[var(--text-muted)] px-1 select-none">⋮⋮</span>
        <span className="font-mono text-sm" style={{ color: accentColor }}>
          {props.indexLabel}
        </span>
        <span className="text-white truncate">{props.name}</span>
        {props.showYoutubeBadge && (
          <span className="text-xs bg-[var(--neon-magenta)]/20 text-[var(--neon-magenta)] px-1.5 py-0.5 rounded">
            YT
          </span>
        )}
      </div>
    </div>
  )
}


function DroppableArea(props: { id: string; className: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: props.id })

  return (
    <div ref={setNodeRef} className={props.className}>
      {props.children}
    </div>
  )
}

export default function RoomPage() {
  const { id } = useParams()
  const { loading: authLoading } = useAuth()

  const [room, setRoom] = useState<Room | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [queue, setQueue] = useState<QueueMember[]>([])
  const [loading, setLoading] = useState(true)
  const [newEntry, setNewEntry] = useState('')
  const [monitoringStatus, setMonitoringStatus] = useState<string>('')
  const [lastAdded, setLastAdded] = useState<string[]>([])
  const [addMessage, setAddMessage] = useState<{
    type: 'success' | 'warning' | 'error'
    text: string
  } | null>(null)
  const [adding, setAdding] = useState(false)
  const [rotateMessage, setRotateMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [rotating, setRotating] = useState(false)

  const [dndMessage, setDndMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  )
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pollerIdRef = useRef<string | null>(null)
  const isMonitoringRef = useRef(false)
  const recommendedMinRef = useRef<number>(0)
  const errorBackoffRef = useRef<number>(0)

  const suppressExternalUpdatesRef = useRef(false)
  const pendingExternalSyncRef = useRef(false)
  const dragStartPointRef = useRef<ClientPoint | null>(null)
  const dragDeltaRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const participantsRef = useRef(participants)
  const queueRef = useRef(queue)
  const roomRef = useRef(room)

  useEffect(() => {
    participantsRef.current = participants
  }, [participants])

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  useEffect(() => {
    roomRef.current = room
  }, [room])

  const fetchRoomData = useCallback(async () => {
    let nextRoom: Room | null = roomRef.current
    let nextParticipants: Participant[] = participantsRef.current
    let nextQueue: QueueMember[] = queueRef.current

    try {
      const [roomRes, participantsRes, queueRes] = await Promise.all([
        fetch(`/api/rooms/${id}`),
        fetch(`/api/rooms/${id}/participants`),
        fetch(`/api/rooms/${id}/queue`),
      ])

      if (roomRes.ok) {
        const data = await roomRes.json()
        nextRoom = data.room ?? null
        setRoom(nextRoom)
      }

      if (participantsRes.ok) {
        const data = await participantsRes.json()
        nextParticipants = data.participants || []
        setParticipants(nextParticipants)
      }

      if (queueRes.ok) {
        const data = await queueRes.json()
        nextQueue = data.queue || []
        setQueue(nextQueue)
      }
    } catch (err) {
      console.error('Failed to fetch room data:', err)
    } finally {
      setLoading(false)
    }

    return { room: nextRoom, participants: nextParticipants, queue: nextQueue }
  }, [id])

  const pollYoutube = useCallback(async () => {
    if (!isMonitoringRef.current) return

    if (!pollerIdRef.current) {
      try {
        const key = 'ytqm_poller_id'
        const existing = sessionStorage.getItem(key)
        const generated = existing || crypto.randomUUID()
        if (!existing) sessionStorage.setItem(key, generated)
        pollerIdRef.current = generated
      } catch {
        pollerIdRef.current = crypto.randomUUID()
      }
    }

    const pollerId = pollerIdRef.current!

    const scheduleNext = (baseDelayMs: number, withJitter = true) => {
      const recommendedMin = recommendedMinRef.current || 0
      const delay = Math.max(recommendedMin, Math.floor(baseDelayMs))
      const jitterMs = withJitter
        ? Math.floor(Math.random() * Math.min(1000, Math.max(0, delay * 0.1)))
        : 0

      if (pollingRef.current) {
        clearTimeout(pollingRef.current)
      }

      pollingRef.current = setTimeout(() => {
        pollYoutube()
      }, delay + jitterMs)
    }

    try {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const res = await fetch(`/api/rooms/${id}/youtube/poll`, {
        headers: { 'x-poller-id': pollerId },
        signal: controller.signal,
      })

      const data: PollResponse = await res.json().catch(() => ({}))

      const ytInterval =
        typeof data?.pollingIntervalMillis === 'number'
          ? data.pollingIntervalMillis
          : typeof data?.pollingIntervalMs === 'number'
            ? data.pollingIntervalMs
            : null

      if (typeof ytInterval === 'number' && ytInterval > 0) {
        recommendedMinRef.current = ytInterval
      }

      const retryAfterMs = typeof data?.retry_after_ms === 'number' ? data.retry_after_ms : null

      if (res.status === 409) {
        scheduleNext(retryAfterMs ?? 1000)
        return
      }

      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }

      errorBackoffRef.current = 0

      let needsRoomSync = false

      if (data.added && data.added.length > 0) {
        setLastAdded(data.added.map((a: { username: string }) => a.username))
        needsRoomSync = true
        setTimeout(() => setLastAdded([]), 3000)
      }

      if (data.next_last_updated) {
        needsRoomSync = true
      }

      if (needsRoomSync) {
        if (!suppressExternalUpdatesRef.current) {
          fetchRoomData()
        } else {
          pendingExternalSyncRef.current = true
        }
      }

      if (!data.isMonitoring) {
        setRoom((prev) => (prev ? { ...prev, is_monitoring: false } : null))
      }

      if (data?.skipped && retryAfterMs) {
        scheduleNext(retryAfterMs, false)
        return
      }

      scheduleNext(retryAfterMs ?? ytInterval ?? 10000)
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name?: string }).name === 'AbortError'
      )
        return

      const nextBackoff = errorBackoffRef.current
        ? Math.min(errorBackoffRef.current * 2, 60000)
        : 2000

      errorBackoffRef.current = nextBackoff
      scheduleNext(nextBackoff)
      console.error('Poll error:', err)
    }
  }, [id, fetchRoomData])

  useEffect(() => {
    if (!authLoading && id) {
      fetchRoomData()
    }
  }, [authLoading, id, fetchRoomData])

  useEffect(() => {
    isMonitoringRef.current = !!room?.is_monitoring

    if (room?.is_monitoring) {
      errorBackoffRef.current = 0
      pollYoutube()
    } else {
      abortRef.current?.abort()
      if (pollingRef.current) {
        clearTimeout(pollingRef.current)
        pollingRef.current = null
      }
    }

    return () => {
      abortRef.current?.abort()
      if (pollingRef.current) {
        clearTimeout(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [room?.is_monitoring, pollYoutube])

  const handleStartMonitoring = async () => {
    setMonitoringStatus('開始中...')
    try {
      const res = await fetch(`/api/rooms/${id}/youtube/start`, { method: 'POST' })
      const data = await res.json()

      if (res.ok) {
        setRoom((prev) => (prev ? { ...prev, is_monitoring: true } : null))
        setMonitoringStatus('')
      } else {
        setMonitoringStatus(data.error)
        setTimeout(() => setMonitoringStatus(''), 3000)
      }
    } catch {
      setMonitoringStatus('エラーが発生しました')
      setTimeout(() => setMonitoringStatus(''), 3000)
    }
  }

  const handleStopMonitoring = async () => {
    try {
      const res = await fetch(`/api/rooms/${id}/youtube/stop`, { method: 'POST' })
      if (res.ok) {
        setRoom((prev) => (prev ? { ...prev, is_monitoring: false } : null))
      }
    } catch (err) {
      console.error('Failed to stop monitoring:', err)
    }
  }

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (adding) return

    const trimmed = newEntry.trim()
    if (!trimmed) return

    setAdding(true)
    setAddMessage(null)

    try {
      const res = await fetch(`/api/rooms/${id}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtube_username: trimmed }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setAddMessage({ type: 'error', text: data.error || '追加に失敗しました' })
        return
      }

      if (data.status === 'already_exists') {
        setAddMessage({ type: 'warning', text: data.message || '既に登録されています' })
        return
      }

      // Optimistic UI update
      if (data.destination === 'participant' && data.entry) {
        setParticipants((prev) => [...prev, data.entry])
      } else if (data.destination === 'queue' && data.entry) {
        setQueue((prev) => [...prev, data.entry])
      }

      if (data.destination === 'participant') {
        setAddMessage({ type: 'success', text: data.message || '参加者に追加しました' })
      } else {
        setAddMessage({ type: 'success', text: data.message || '待機リストに追加しました' })
      }

      setNewEntry('')
      // No sync - fully optimistic (only revert on error)
    } catch (err) {
      console.error('Failed to add entry:', err)
      setAddMessage({ type: 'error', text: '通信エラーで追加できませんでした' })
    } finally {
      setAdding(false)
      setTimeout(() => setAddMessage(null), 2500)
    }
  }

  const handleRemoveParticipant = async (participantId: string) => {
    // Optimistic UI update
    setParticipants((prev) => prev.filter((p) => p.id !== participantId))

    try {
      const res = await fetch(`/api/rooms/${id}/participants/${participantId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        // Revert on failure
        fetchRoomData()
      }
      // No sync on success - fully optimistic
    } catch (err) {
      console.error('Failed to remove participant:', err)
      // Revert on error
      fetchRoomData()
    }
  }

  const handleRemoveFromQueue = async (queueId: string) => {
    // Optimistic UI update
    const removedPosition = queue.find((q) => q.id === queueId)?.position
    setQueue((prev) => {
      const filtered = prev.filter((q) => q.id !== queueId)
      // Re-number positions
      if (removedPosition !== undefined) {
        return filtered.map((q) =>
          q.position > removedPosition ? { ...q, position: q.position - 1 } : q
        )
      }
      return filtered
    })

    try {
      const res = await fetch(`/api/rooms/${id}/queue/${queueId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        // Revert on failure
        fetchRoomData()
      }
      // No sync on success - fully optimistic
    } catch (err) {
      console.error('Failed to remove from queue:', err)
      // Revert on error
      fetchRoomData()
    }
  }

  const handleRotate = async () => {
    if (rotating) return

    const isMonitoring = !!room?.is_monitoring
    const hasAnyNextLast =
      participants.some((p) => p.is_next_last) || queue.some((q) => q.is_next_last)

    const canRotate = isMonitoring ? queue.length > 0 || hasAnyNextLast : queue.length > 0

    if (!canRotate) {
      setRotateMessage({ type: 'error', text: '交代できる対象がありません' })
      setTimeout(() => setRotateMessage(null), 2500)
      return
    }

    setRotating(true)
    try {
      const res = await fetch(`/api/rooms/${id}/rotate`, {
        method: 'POST',
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setRotateMessage({ type: 'error', text: data.error || '交代に失敗しました' })
        fetchRoomData()
        return
      }

      if (data?.room) {
        setRoom((prev) => (prev ? { ...prev, ...data.room } : prev))
      }
      if (Array.isArray(data?.participants)) {
        setParticipants(data.participants)
      }
      if (Array.isArray(data?.queue)) {
        setQueue(data.queue)
      }

      const removedParty = Array.isArray(data?.removed_next_last_party)
        ? data.removed_next_last_party.length
        : 0
      const removedQueue = Array.isArray(data?.removed_next_last_queue)
        ? data.removed_next_last_queue.length
        : 0
      const shortage = typeof data?.party_shortage === 'number' ? data.party_shortage : 0

      let message = typeof data?.message === 'string' ? data.message : '交代しました'
      if (shortage > 0 && !message.includes('不足')) {
        message += `（不足 ${shortage}人）`
      }

      if (!data?.message && (removedParty > 0 || removedQueue > 0)) {
        message = `次ラスト削除:参加${removedParty}人/待機${removedQueue}人` +
          (shortage > 0 ? `（不足 ${shortage}人）` : '')
      }

      setRotateMessage({ type: 'success', text: message })
    } catch (err) {
      console.error('Failed to rotate:', err)
      setRotateMessage({ type: 'error', text: '通信エラーで交代できませんでした' })
      fetchRoomData()
    } finally {
      setRotating(false)
      setTimeout(() => setRotateMessage(null), 2500)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  )

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args)
    const itemCollisions = pointer.filter(
      (c) => c.id !== PARTY_CONTAINER_ID && c.id !== QUEUE_CONTAINER_ID
    )

    if (itemCollisions.length > 0) return itemCollisions
    if (pointer.length > 0) return pointer

    return rectIntersection(args)
  }, [])

  const partyUsernames = useMemo(
    () => participants.map((p) => p.youtube_username),
    [participants]
  )
  const queueUsernames = useMemo(() => queue.map((q) => q.youtube_username), [queue])

  const hasAnyNextLast = participants.some((p) => p.is_next_last) || queue.some((q) => q.is_next_last)
  const canRotate = room?.is_monitoring ? queue.length > 0 || hasAnyNextLast : queue.length > 0


  const postDnd = useCallback(
    async (expectedVersion: number, clientOpId: string, op: DndOp) => {
      const res = await fetch(`/api/rooms/${id}/dnd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_version: expectedVersion,
          client_op_id: clientOpId,
          op,
        }),
      })

      const data = await res.json().catch(() => ({}))
      return { res, data }
    },
    [id]
  )

  const applyServerState = useCallback(
    (payload: { version?: number; participants?: Participant[]; queue?: QueueMember[] }) => {
      if (typeof payload.version === 'number') {
        const version = payload.version
        setRoom((prev) => (prev ? { ...prev, order_version: version } : prev))
      }

      if (Array.isArray(payload.participants)) {
        setParticipants(payload.participants)
      }

      if (Array.isArray(payload.queue)) {
        setQueue(payload.queue)
      }
    },
    []
  )

  const computePointer = useCallback(() => {
    if (!dragStartPointRef.current) return null
    return {
      x: dragStartPointRef.current.x + dragDeltaRef.current.x,
      y: dragStartPointRef.current.y + dragDeltaRef.current.y,
    }
  }, [])

  const computeDropIndicator = useCallback(
    (over: DragOverEvent['over']): DropIndicator => {
      if (!over) return null

      if (over.id === PARTY_CONTAINER_ID) {
        return { list: 'party', overId: null, edge: 'empty' }
      }

      if (over.id === QUEUE_CONTAINER_ID) {
        return { list: 'queue', overId: null, edge: 'empty' }
      }

      const overId = String(over.id)
      const list = (over.data.current?.list as DndList | undefined) ??
        (partyUsernames.includes(overId) ? 'party' : 'queue')

      const pointer = computePointer()
      const midY = over.rect.top + over.rect.height / 2
      const edge: DndEdge = pointer && pointer.y < midY ? 'before' : 'after'

      return { list, overId, edge }
    },
    [computePointer, partyUsernames]
  )

  const applyOptimisticOp = useCallback(
    (clientOpId: string, op: DndOp) => {
      const party = [...participantsRef.current]
      const queueItems = [...queueRef.current]

      const partySize = roomRef.current?.party_size ?? 0

      const sourceId = op.source.id
      const destOverId = op.dest.overId

      const commitState = (nextParty: Participant[], nextQueue: QueueMember[]) => {
        if (op.source.list !== op.dest.list) {
          const normalized = normalizePartyAndQueueByPartySize(
            clientOpId,
            nextParty,
            nextQueue,
            partySize
          )
          setParticipants(normalized.party)
          setQueue(normalized.queue)
          return
        }

        setParticipants(nextParty)
        setQueue(normalizeQueuePositions(nextQueue))
      }

      if (op.mode === 'swap') {
        if (op.source.list !== 'queue' || op.dest.list !== 'party' || !destOverId) return

        const sourceQueueIndex = queueItems.findIndex((q) => q.youtube_username === sourceId)
        const partyOverIndex = party.findIndex((p) => p.youtube_username === destOverId)
        if (sourceQueueIndex === -1 || partyOverIndex === -1) {
          return
        }

        const sourceQueueMember = queueItems[sourceQueueIndex]
        const displacedParticipant = party[partyOverIndex]

        party[partyOverIndex] = makeTempParticipant(clientOpId, sourceQueueMember)
        queueItems[sourceQueueIndex] = makeTempQueueMember(
          clientOpId,
          displacedParticipant,
          sourceQueueIndex
        )

        commitState(party, queueItems)
        return
      }

      // insert
      let nextParty = party
      let nextQueue = queueItems

      if (op.source.list === 'party') {
        nextParty = nextParty.filter((p) => p.youtube_username !== sourceId)
      } else {
        nextQueue = nextQueue.filter((q) => q.youtube_username !== sourceId)
      }

      const insertInto = op.dest.list

      if (op.dest.overId === null) {
        if (op.dest.edge !== 'empty') return

        if (insertInto === 'party') {
          const sourceQueueMember = queueItems.find((q) => q.youtube_username === sourceId)
          const movedParticipant =
            op.source.list === 'party'
              ? party.find((p) => p.youtube_username === sourceId) ?? null
              : sourceQueueMember
                ? makeTempParticipant(clientOpId, sourceQueueMember)
                : null

          if (!movedParticipant) return

          nextParty = [...nextParty, movedParticipant]

          commitState(nextParty, nextQueue)
        }

        if (insertInto === 'queue') {
          const sourceParticipant = party.find((p) => p.youtube_username === sourceId)
          const sourceQueueMember = queueItems.find((q) => q.youtube_username === sourceId)

          const movedQueueMember =
            op.source.list === 'queue'
              ? sourceQueueMember
              : sourceParticipant
                ? makeTempQueueMember(clientOpId, sourceParticipant, nextQueue.length)
                : null

          if (!movedQueueMember) return

          nextQueue = [...nextQueue, { ...movedQueueMember, position: nextQueue.length }]

          commitState(nextParty, nextQueue)
        }

        return
      }

      if (op.dest.edge === 'empty') return

      const overId = op.dest.overId
      if (!overId) return

      if (insertInto === 'party') {
        const overIndex = nextParty.findIndex((p) => p.youtube_username === overId)
        if (overIndex === -1) return

        const insertIndex = op.dest.edge === 'before' ? overIndex : overIndex + 1

        const sourceQueueMember = queueItems.find((q) => q.youtube_username === sourceId)
        const sourceParticipant = party.find((p) => p.youtube_username === sourceId)
        const movedParticipant =
          op.source.list === 'party'
            ? sourceParticipant
            : sourceQueueMember
              ? makeTempParticipant(clientOpId, sourceQueueMember)
              : null

        if (!movedParticipant) return

        nextParty = [...nextParty]
        nextParty.splice(insertIndex, 0, movedParticipant)

        commitState(nextParty, nextQueue)
      }

      if (insertInto === 'queue') {
        const overIndex = nextQueue.findIndex((q) => q.youtube_username === overId)
        if (overIndex === -1) return

        const insertIndex = op.dest.edge === 'before' ? overIndex : overIndex + 1

        const sourceQueueMember = queueItems.find((q) => q.youtube_username === sourceId)
        const sourceParticipant = party.find((p) => p.youtube_username === sourceId)
        const movedQueueMember =
          op.source.list === 'queue'
            ? sourceQueueMember
            : sourceParticipant
              ? makeTempQueueMember(clientOpId, sourceParticipant, insertIndex)
              : null

        if (!movedQueueMember) return

        nextQueue = [...nextQueue]
        nextQueue.splice(insertIndex, 0, movedQueueMember)

        commitState(nextParty, nextQueue)
      }
    },
    []
  )

  const clearDndSuppression = useCallback(async () => {
    suppressExternalUpdatesRef.current = false
    dragStartPointRef.current = null
    dragDeltaRef.current = { x: 0, y: 0 }
    setActiveDragId(null)
    setDropIndicator(null)

    if (pendingExternalSyncRef.current) {
      pendingExternalSyncRef.current = false
      await fetchRoomData()
    }
  }, [fetchRoomData])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    suppressExternalUpdatesRef.current = true
    setDndMessage(null)

    const point = getClientPoint(event.activatorEvent as Event)
    dragStartPointRef.current = point
    dragDeltaRef.current = { x: 0, y: 0 }

    setActiveDragId(String(event.active.id))
  }, [])

  const handleDragCancel = useCallback(() => {
    void clearDndSuppression()
  }, [clearDndSuppression])

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      dragDeltaRef.current = { x: event.delta.x, y: event.delta.y }
      setDropIndicator(computeDropIndicator(event.over))
    },
    [computeDropIndicator]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      dragDeltaRef.current = { x: event.delta.x, y: event.delta.y }
      setDropIndicator(computeDropIndicator(event.over))
    },
    [computeDropIndicator]
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      dragDeltaRef.current = { x: event.delta.x, y: event.delta.y }

      const sourceId = String(event.active.id)
      const sourceList = (event.active.data.current?.list as DndList | undefined) ??
        (participantsRef.current.some((p) => p.youtube_username === sourceId)
          ? 'party'
          : 'queue')

      const indicator = computeDropIndicator(event.over)
      setDropIndicator(indicator)

      if (!indicator) {
        await clearDndSuppression()
        return
      }

      const op: DndOp = {
        source: { list: sourceList, id: sourceId },
        dest: { list: indicator.list, overId: indicator.overId, edge: indicator.edge },
        mode: 'insert',
      }

      const clientOpId = crypto.randomUUID()
      const expectedVersion = roomRef.current?.order_version ?? 0

      // Optimistic update
      applyOptimisticOp(clientOpId, op)

      try {
        const first = await postDnd(expectedVersion, clientOpId, op)

        if (first.res.ok) {
          applyServerState(first.data)
          return
        }

        if (first.res.status === 409) {
          const snapshot = await fetchRoomData()
          const latestVersion = snapshot.room?.order_version ?? roomRef.current?.order_version ?? 0

          if (op.dest.overId !== null) {
            const existsInDest =
              op.dest.list === 'party'
                ? snapshot.participants.some((p) => p.youtube_username === op.dest.overId)
                : snapshot.queue.some((q) => q.youtube_username === op.dest.overId)

            if (!existsInDest) {
              setDndMessage({
                type: 'error',
                text: '競合が発生しました。最新状態に同期したので、もう一度お試しください。',
              })
              return
            }
          }

          const replay = await postDnd(latestVersion, clientOpId, op)

          if (replay.res.ok) {
            applyServerState(replay.data)
            return
          }

          await fetchRoomData()
          setDndMessage({
            type: 'error',
            text: '競合が解決できませんでした。もう一度お試しください。',
          })
          return
        }

        await fetchRoomData()
        setDndMessage({ type: 'error', text: '並び替えに失敗しました。もう一度お試しください。' })
      } catch {
        await fetchRoomData()
        setDndMessage({ type: 'error', text: '通信エラーで並び替えできませんでした。' })
      } finally {
        await clearDndSuppression()
      }
    },
    [applyOptimisticOp, applyServerState, clearDndSuppression, computeDropIndicator, fetchRoomData, postDnd]
  )

  const activeOverlayData = useMemo(() => {
    if (!activeDragId) return null

    const inParty = participants.find((p) => p.youtube_username === activeDragId)
    if (inParty) {
      const index = participants.findIndex((p) => p.youtube_username === activeDragId)
      return {
        list: 'party' as const,
        indexLabel: `${index + 1}.`,
        accentVar: 'cyan' as const,
        name: inParty.display_name || inParty.youtube_username,
        showYoutubeBadge: inParty.source === 'youtube',
      }
    }

    const inQueue = queue.find((q) => q.youtube_username === activeDragId)
    if (inQueue) {
      return {
        list: 'queue' as const,
        indexLabel: `${(inQueue.position ?? 0) + 1}.`,
        accentVar: 'yellow' as const,
        name: inQueue.display_name || inQueue.youtube_username,
        showYoutubeBadge: inQueue.source === 'youtube',
      }
    }

    return null
  }, [activeDragId, participants, queue])

  const isPartyEmptyDropTarget =
    dropIndicator?.list === 'party' && dropIndicator.overId === null && dropIndicator.edge === 'empty'
  const isQueueEmptyDropTarget =
    dropIndicator?.list === 'queue' && dropIndicator.overId === null && dropIndicator.edge === 'empty'

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="font-pixel text-[var(--neon-cyan)] animate-pulse-glow">LOADING...</div>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="font-pixel text-[var(--neon-magenta)] mb-4">NOT FOUND</div>
          <Link href="/dashboard" className="text-[var(--neon-cyan)] hover:underline">
            ← ダッシュボードに戻る
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen relative">
      {/* Background grid */}
      <div
        className="fixed inset-0 opacity-5 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0, 255, 245, 0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0, 255, 245, 0.5) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* Header */}
      <header className="bg-[var(--bg-secondary)] border-b-2 border-[var(--border-color)] relative z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-[var(--text-muted)] hover:text-[var(--neon-cyan)] transition-colors"
            >
              ← BACK
            </Link>
            <h1 className="font-pixel text-sm text-white">{room.name}</h1>
          </div>
          <Link
            href={`/rooms/${id}/settings`}
            className="text-[var(--text-muted)] hover:text-[var(--neon-cyan)] transition-colors text-sm"
          >
            ⚙ SETTINGS
          </Link>
        </div>
      </header>

      {/* YouTube Status bar */}
      <div className="bg-[var(--bg-card)] border-b border-[var(--border-color)] relative z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-[var(--text-muted)]">YouTube監視:</span>
            {room.is_monitoring ? (
              <button
                onClick={handleStopMonitoring}
                className="flex items-center gap-2 bg-[var(--neon-green)]/20 border border-[var(--neon-green)] text-[var(--neon-green)] px-3 py-1 rounded text-xs hover:bg-[var(--neon-green)]/30 transition-colors"
              >
                <span className="w-2 h-2 bg-[var(--neon-green)] rounded-full animate-pulse" />
                ON - クリックで停止
              </button>
            ) : (
              <button
                onClick={handleStartMonitoring}
                disabled={!room.youtube_video_id}
                className="flex items-center gap-2 bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-muted)] px-3 py-1 rounded text-xs hover:border-[var(--neon-cyan)] hover:text-[var(--neon-cyan)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                OFF - クリックで開始
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)]">キーワード:</span>
            <span className="text-[var(--neon-yellow)]">「{room.keyword}」</span>
          </div>
          {!room.youtube_video_id && (
            <span className="text-[var(--neon-orange)] text-xs">※ YouTube URLを設定してください</span>
          )}
          {monitoringStatus && (
            <span className="text-[var(--neon-magenta)] text-xs">{monitoringStatus}</span>
          )}
        </div>
      </div>

      {/* Last added notification */}
      {lastAdded.length > 0 && (
        <div className="bg-[var(--neon-green)]/20 border-b border-[var(--neon-green)] relative z-10">
          <div className="max-w-7xl mx-auto px-4 py-2 text-sm text-[var(--neon-green)]">
            ✓ 追加: {lastAdded.join(', ')}
          </div>
        </div>
      )}

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 py-6 relative z-10">
        <div className="arcade-card p-5 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="font-pixel text-sm neon-text-cyan">ADD PLAYER</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">空きがあれば参加者へ、満員なら待機へ自動追加</div>
            </div>

            <form onSubmit={handleAddEntry} className="flex gap-2 w-full md:max-w-md">
              <input
                type="text"
                value={newEntry}
                onChange={(e) => setNewEntry(e.target.value)}
                className="arcade-input flex-1 text-sm"
                placeholder="YouTube表示名を入力"
                disabled={adding}
              />
              <button type="submit" className="arcade-btn text-xs px-4" disabled={adding}>
                {adding ? 'ADDING...' : 'ADD'}
              </button>
            </form>
          </div>

          {addMessage && (
            <div
              className={
                addMessage.type === 'success'
                  ? 'mt-3 bg-[var(--neon-green)]/15 border border-[var(--neon-green)] text-[var(--neon-green)] px-4 py-2 rounded text-sm'
                  : addMessage.type === 'warning'
                    ? 'mt-3 bg-[var(--neon-yellow)]/15 border border-[var(--neon-yellow)] text-[var(--neon-yellow)] px-4 py-2 rounded text-sm'
                    : 'mt-3 bg-[var(--neon-magenta)]/15 border border-[var(--neon-magenta)] text-[var(--neon-magenta)] px-4 py-2 rounded text-sm'
              }
            >
              {addMessage.type === 'success' ? '✓ ' : addMessage.type === 'warning' ? '⚠ ' : '✕ '}
              {addMessage.text}
            </div>
          )}
        </div>

        {dndMessage && (
          <div
            className={
              dndMessage.type === 'success'
                ? 'mb-4 bg-[var(--neon-green)]/15 border border-[var(--neon-green)] text-[var(--neon-green)] px-4 py-2 rounded text-sm'
                : 'mb-4 bg-[var(--neon-magenta)]/15 border border-[var(--neon-magenta)] text-[var(--neon-magenta)] px-4 py-2 rounded text-sm'
            }
          >
            {dndMessage.type === 'success' ? '✓ ' : '⚠ '} {dndMessage.text}
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="grid md:grid-cols-2 gap-6">
            {/* Participants */}
            <div className="arcade-card p-6 relative">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-pixel text-sm neon-text-green flex items-center gap-2">🎮 現在の参加者</h2>
                <span className="text-[var(--text-secondary)] text-sm">
                  {participants.length}/{room.party_size}人
                </span>
              </div>

              <DroppableArea
                id={PARTY_CONTAINER_ID}
                className={
                  'space-y-2 mb-4 min-h-[96px] rounded ' +
                  (isPartyEmptyDropTarget
                    ? 'ring-2 ring-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5'
                    : '')
                }
              >
                <SortableContext items={partyUsernames} strategy={verticalListSortingStrategy}>
                  {participants.length === 0 ? (
                    <p className="text-[var(--text-muted)] text-sm text-center py-4">参加者がいません</p>
                  ) : (
                    participants.map((p, i) => (
                      <SortableArcadeRow
                        key={p.youtube_username}
                        itemId={p.youtube_username}
                        list="party"
                        indexLabel={`${i + 1}.`}
                        accentVar="cyan"
                        name={p.display_name || p.youtube_username}
                        showYoutubeBadge={p.source === 'youtube'}
                        showNextLastBadge={room.is_monitoring && p.is_next_last}
                        onRemove={() => handleRemoveParticipant(p.id)}
                        indicatorEdge={
                          dropIndicator?.list === 'party' &&
                          dropIndicator.overId === p.youtube_username &&
                          dropIndicator.edge !== 'empty'
                            ? dropIndicator.edge
                            : null
                        }
                      />
                    ))
                  )}
                </SortableContext>
              </DroppableArea>

              {/* Decorative corners */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[var(--neon-green)]" />
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[var(--neon-green)]" />
            </div>

            {/* Queue */}
            <div className="arcade-card p-6 relative">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-pixel text-sm neon-text-yellow flex items-center gap-2">⏳ 待機リスト</h2>
                <span className="text-[var(--text-secondary)] text-sm">{queue.length}人</span>
              </div>

              <DroppableArea
                id={QUEUE_CONTAINER_ID}
                className={
                  'space-y-2 mb-4 min-h-[96px] rounded ' +
                  (isQueueEmptyDropTarget
                    ? 'ring-2 ring-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5'
                    : '')
                }
              >
                <SortableContext items={queueUsernames} strategy={verticalListSortingStrategy}>
                  {queue.length === 0 ? (
                    <p className="text-[var(--text-muted)] text-sm text-center py-4">待機者がいません</p>
                  ) : (
                    queue.map((q) => (
                      <SortableArcadeRow
                        key={q.youtube_username}
                        itemId={q.youtube_username}
                        list="queue"
                        indexLabel={`${q.position + 1}.`}
                        accentVar="yellow"
                        name={q.display_name || q.youtube_username}
                        showYoutubeBadge={q.source === 'youtube'}
                        showNextLastBadge={room.is_monitoring && q.is_next_last}
                        onRemove={() => handleRemoveFromQueue(q.id)}
                        indicatorEdge={
                          dropIndicator?.list === 'queue' &&
                          dropIndicator.overId === q.youtube_username &&
                          dropIndicator.edge !== 'empty'
                            ? dropIndicator.edge
                            : null
                        }
                      />
                    ))
                  )}
                </SortableContext>
              </DroppableArea>

              {/* Decorative corners */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[var(--neon-yellow)]" />
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[var(--neon-yellow)]" />
            </div>
          </div>

          <DragOverlay>
            {activeOverlayData ? (
              <DragOverlayRow
                indexLabel={activeOverlayData.indexLabel}
                accentVar={activeOverlayData.accentVar}
                name={activeOverlayData.name}
                showYoutubeBadge={activeOverlayData.showYoutubeBadge}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Rotate button */}
        <div className="mt-8">
          {rotateMessage && (
            <div
              className={
                rotateMessage.type === 'success'
                  ? 'mb-3 bg-[var(--neon-green)]/15 border border-[var(--neon-green)] text-[var(--neon-green)] px-4 py-2 rounded text-sm'
                  : 'mb-3 bg-[var(--neon-magenta)]/15 border border-[var(--neon-magenta)] text-[var(--neon-magenta)] px-4 py-2 rounded text-sm'
              }
            >
              {rotateMessage.type === 'success' ? '✓ ' : '⚠ '} {rotateMessage.text}
            </div>
          )}

          {!canRotate && (
            <div className="mb-3 text-[var(--text-muted)] text-xs">待機リストに1人以上追加すると交代できます</div>
          )}

          <button
            onClick={handleRotate}
            className="arcade-btn w-full py-4 text-base"
            disabled={!canRotate || rotating}
          >
            {rotating
              ? 'ROTATING...'
              : !canRotate
                ? '交代メンバーがいません'
                : room?.is_monitoring
                  ? '🔄 交代する（次ラスト）'
                  : `🔄 交代する（${Math.min(room?.rotate_count ?? 1, queue.length)}人入れ替え）`}
          </button>
        </div>
      </main>

      {/* CRT overlay */}
      <div className="crt-overlay" />
    </div>
  )
}
