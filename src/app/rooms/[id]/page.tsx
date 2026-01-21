'use client'

import { useAuth } from '@/hooks/useAuth'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState, useCallback, useRef } from 'react'

interface Room {
  id: string
  name: string
  youtube_url: string | null
  youtube_video_id: string | null
  keyword: string
  party_size: number
  rotate_count: number
  is_monitoring: boolean
}

interface Participant {
  id: string
  youtube_username: string
  display_name: string | null
  joined_at: string
  source: 'manual' | 'youtube'
}

interface QueueMember {
  id: string
  youtube_username: string
  display_name: string | null
  position: number
  source: 'manual' | 'youtube'
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
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  const fetchRoomData = useCallback(async () => {
    try {
      const [roomRes, participantsRes, queueRes] = await Promise.all([
        fetch(`/api/rooms/${id}`),
        fetch(`/api/rooms/${id}/participants`),
        fetch(`/api/rooms/${id}/queue`),
      ])

      if (roomRes.ok) {
        const data = await roomRes.json()
        setRoom(data.room)
      }
      if (participantsRes.ok) {
        const data = await participantsRes.json()
        setParticipants(data.participants || [])
      }
      if (queueRes.ok) {
        const data = await queueRes.json()
        setQueue(data.queue || [])
      }
    } catch (err) {
      console.error('Failed to fetch room data:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  const pollYoutube = useCallback(async () => {
    if (!room?.is_monitoring) return
    
    try {
      const res = await fetch(`/api/rooms/${id}/youtube/poll`)
      const data = await res.json()
      
      if (data.added && data.added.length > 0) {
        setLastAdded(data.added.map((a: { username: string }) => a.username))
        fetchRoomData()
        setTimeout(() => setLastAdded([]), 3000)
      }
      
      if (!data.isMonitoring) {
        setRoom(prev => prev ? { ...prev, is_monitoring: false } : null)
      }
    } catch (err) {
      console.error('Poll error:', err)
    }
  }, [id, room?.is_monitoring, fetchRoomData])

  useEffect(() => {
    if (!authLoading && id) {
      fetchRoomData()
    }
  }, [authLoading, id, fetchRoomData])

  useEffect(() => {
    if (room?.is_monitoring) {
      pollingRef.current = setInterval(pollYoutube, 10000)
      pollYoutube()
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [room?.is_monitoring, pollYoutube])

  const handleStartMonitoring = async () => {
    setMonitoringStatus('開始中...')
    try {
      const res = await fetch(`/api/rooms/${id}/youtube/start`, { method: 'POST' })
      const data = await res.json()
      
      if (res.ok) {
        setRoom(prev => prev ? { ...prev, is_monitoring: true } : null)
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
        setRoom(prev => prev ? { ...prev, is_monitoring: false } : null)
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
        setParticipants(prev => [...prev, data.entry])
      } else if (data.destination === 'queue' && data.entry) {
        setQueue(prev => [...prev, data.entry])
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
    setParticipants(prev => prev.filter(p => p.id !== participantId))

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
    const removedPosition = queue.find(q => q.id === queueId)?.position
    setQueue(prev => {
      const filtered = prev.filter(q => q.id !== queueId)
      // Re-number positions
      if (removedPosition !== undefined) {
        return filtered.map(q =>
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

    if (queue.length === 0) {
      setRotateMessage({ type: 'error', text: '待機者がいないため交代できません' })
      setTimeout(() => setRotateMessage(null), 2500)
      return
    }

    // Optimistic UI update for rotate
    const rotateCount = Math.min(room?.rotate_count || 1, queue.length)
    const participantsToRotate = participants.slice(0, rotateCount)
    const queueToMove = queue.slice(0, rotateCount)

    setParticipants(prev => {
      const remaining = prev.slice(rotateCount)
      const newEntries = queueToMove.map(q => ({
        id: `temp-${Date.now()}-${Math.random()}`,
        youtube_username: q.youtube_username,
        display_name: q.display_name,
        joined_at: new Date().toISOString(),
        source: q.source,
      }))
      return [...remaining, ...newEntries]
    })

    setQueue(prev => {
      const remaining = prev.slice(rotateCount)
      const rotatedMembers = participantsToRotate.map((p, index) => ({
        id: `temp-queue-${Date.now()}-${Math.random()}`,
        youtube_username: p.youtube_username,
        display_name: p.display_name,
        position: remaining.length + index + 1,
        source: p.source,
      }))
      return [...remaining, ...rotatedMembers]
    })

    setRotating(true)
    try {
      const res = await fetch(`/api/rooms/${id}/rotate`, {
        method: 'POST',
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setRotateMessage({ type: 'error', text: data.error || '交代に失敗しました' })
        // Revert on failure
        fetchRoomData()
        return
      }

      setRotateMessage({ type: 'success', text: data.message || '交代しました' })
      // No sync - fully optimistic (only revert on error)
    } catch (err) {
      console.error('Failed to rotate:', err)
      setRotateMessage({ type: 'error', text: '通信エラーで交代できませんでした' })
      // Revert on error
      fetchRoomData()
    } finally {
      setRotating(false)
      setTimeout(() => setRotateMessage(null), 2500)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="font-pixel text-[var(--neon-cyan)] animate-pulse-glow">
          LOADING...
        </div>
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
          backgroundSize: '50px 50px'
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
            <span className="text-[var(--neon-orange)] text-xs">
              ※ YouTube URLを設定してください
            </span>
          )}
          {monitoringStatus && (
            <span className="text-[var(--neon-magenta)] text-xs">
              {monitoringStatus}
            </span>
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
              <div className="text-xs text-[var(--text-muted)] mt-1">
                空きがあれば参加者へ、満員なら待機へ自動追加
              </div>
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
              <button
                type="submit"
                className="arcade-btn text-xs px-4"
                disabled={adding}
              >
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

        <div className="grid md:grid-cols-2 gap-6">
          {/* Participants */}
          <div className="arcade-card p-6 relative">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-pixel text-sm neon-text-green flex items-center gap-2">
                🎮 現在の参加者
              </h2>
              <span className="text-[var(--text-secondary)] text-sm">
                {participants.length}/{room.party_size}人
              </span>
            </div>

            <div className="space-y-2 mb-4">
              {participants.length === 0 ? (
                <p className="text-[var(--text-muted)] text-sm text-center py-4">
                  参加者がいません
                </p>
              ) : (
                participants.map((p, i) => (
                  <div 
                    key={p.id}
                    className="flex items-center justify-between bg-[var(--bg-secondary)] p-3 rounded"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[var(--neon-cyan)] font-mono text-sm">{i + 1}.</span>
                      <span className="text-white">{p.display_name || p.youtube_username}</span>
                      {p.source === 'youtube' && (
                        <span className="text-xs bg-[var(--neon-magenta)]/20 text-[var(--neon-magenta)] px-1.5 py-0.5 rounded">YT</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveParticipant(p.id)}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Decorative corners */}
            <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[var(--neon-green)]" />
            <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[var(--neon-green)]" />
          </div>

          {/* Queue */}
          <div className="arcade-card p-6 relative">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-pixel text-sm neon-text-yellow flex items-center gap-2">
                ⏳ 待機リスト
              </h2>
              <span className="text-[var(--text-secondary)] text-sm">
                {queue.length}人
              </span>
            </div>

            <div className="space-y-2 mb-4">
              {queue.length === 0 ? (
                <p className="text-[var(--text-muted)] text-sm text-center py-4">
                  待機者がいません
                </p>
              ) : (
                queue.map((q) => (
                  <div 
                    key={q.id}
                    className="flex items-center justify-between bg-[var(--bg-secondary)] p-3 rounded"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[var(--neon-yellow)] font-mono text-sm">{q.position}.</span>
                      <span className="text-white">{q.display_name || q.youtube_username}</span>
                      {q.source === 'youtube' && (
                        <span className="text-xs bg-[var(--neon-magenta)]/20 text-[var(--neon-magenta)] px-1.5 py-0.5 rounded">YT</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveFromQueue(q.id)}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Decorative corners */}
            <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[var(--neon-yellow)]" />
            <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[var(--neon-yellow)]" />
          </div>
        </div>

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

          {queue.length === 0 && (
            <div className="mb-3 text-[var(--text-muted)] text-xs">
              待機リストに1人以上追加すると交代できます
            </div>
          )}

          <button
            onClick={handleRotate}
            className="arcade-btn w-full py-4 text-base"
            disabled={queue.length === 0 || rotating}
          >
            {rotating
              ? 'ROTATING...'
              : queue.length === 0
                ? '交代メンバーがいません'
                : `🔄 交代する（${Math.min(room.rotate_count, queue.length)}人入れ替え）`}
          </button>
        </div>
      </main>

      {/* CRT overlay */}
      <div className="crt-overlay" />
    </div>
  )
}
