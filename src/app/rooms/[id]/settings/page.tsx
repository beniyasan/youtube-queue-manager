'use client'

import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Room {
  id: string
  name: string
  youtube_url: string | null
  keyword: string
  next_last_keyword: string
  party_size: number
  rotate_count: number
}

export default function RoomSettingsPage() {
  const { id } = useParams()
  const router = useRouter()

  const [room, setRoom] = useState<Room | null>(null)
  const [name, setName] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [keyword, setKeyword] = useState('')
  const [nextLastKeyword, setNextLastKeyword] = useState('')
  const [partySize, setPartySize] = useState(4)
  const [rotateCount, setRotateCount] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [clearingNextLast, setClearingNextLast] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const fetchRoom = async () => {
      try {
        const res = await fetch(`/api/rooms/${id}`)
        if (res.ok) {
          const data = await res.json()
          setRoom(data.room)
          setName(data.room.name)
          setYoutubeUrl(data.room.youtube_url || '')
          setKeyword(data.room.keyword)
          setNextLastKeyword(data.room.next_last_keyword || '')
          setPartySize(data.room.party_size)
          setRotateCount(data.room.rotate_count)
        }
      } catch (err) {
        console.error('Failed to fetch room:', err)
      } finally {
        setLoading(false)
      }
    }

    if (id) fetchRoom()
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSaving(true)

    try {
      const res = await fetch(`/api/rooms/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          youtube_url: youtubeUrl,
          keyword,
          next_last_keyword: nextLastKeyword,
          party_size: partySize,
          rotate_count: rotateCount,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error)
        return
      }

      setSuccess('設定を保存しました')
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleClearNextLastReservations = async () => {
    setError('')
    setSuccess('')
    setClearingNextLast(true)

    try {
      const res = await fetch(`/api/rooms/${id}/next-last/clear`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }

      if (!res.ok) {
        setError(data.error || '次ラスト予約の全解除に失敗しました')
        return
      }

      setSuccess(data.message || '次ラスト予約を全解除しました')
    } catch {
      setError('次ラスト予約の全解除に失敗しました')
    } finally {
      setClearingNextLast(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('このルームを削除しますか？この操作は取り消せません。')) {
      return
    }

    setDeleting(true)
    try {
      const res = await fetch(`/api/rooms/${id}`, { method: 'DELETE' })
      if (res.ok) {
        router.push('/dashboard')
      }
    } catch {
      setError('削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
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
          backgroundSize: '50px 50px',
        }}
      />

      {/* Header */}
      <header className="bg-[var(--bg-secondary)] border-b-2 border-[var(--border-color)] relative z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href={`/rooms/${id}`}
            className="text-[var(--text-muted)] hover:text-[var(--neon-cyan)] transition-colors"
          >
            ← BACK
          </Link>
          <h1 className="font-pixel text-sm neon-text-cyan">SETTINGS</h1>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-2xl mx-auto px-4 py-8 relative z-10">
        <div className="arcade-card p-8 relative">
          <h2 className="font-pixel text-lg text-white mb-6">ROOM SETTINGS</h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-900/30 border border-red-500 text-red-400 p-3 rounded text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-900/30 border border-green-500 text-green-400 p-3 rounded text-sm">
                {success}
              </div>
            )}

            {/* Room Name */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                ルーム名 <span className="text-[var(--neon-magenta)]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="arcade-input"
                required
              />
            </div>

            {/* YouTube URL */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                YouTube配信URL
              </label>
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="arcade-input"
                placeholder="https://youtube.com/watch?v=xxxxx"
              />
            </div>

            {/* Keyword */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                参加キーワード
              </label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="arcade-input"
              />
            </div>

            {/* Next Last Keyword */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                次ラストキーワード <span className="text-[var(--neon-magenta)]">*</span>
              </label>
              <input
                type="text"
                value={nextLastKeyword}
                onChange={(e) => setNextLastKeyword(e.target.value)}
                className="arcade-input"
                required
              />
            </div>

            {/* Party Size & Rotate Count */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  パーティー人数
                </label>
                <input
                  type="number"
                  value={partySize}
                  onChange={(e) => setPartySize(Number(e.target.value))}
                  className="arcade-input"
                  min={1}
                  max={20}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  1回の交代人数
                </label>
                <input
                  type="number"
                  value={rotateCount}
                  onChange={(e) => setRotateCount(Number(e.target.value))}
                  className="arcade-input"
                  min={1}
                  max={partySize}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="arcade-btn w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'SAVING...' : 'SAVE SETTINGS'}
            </button>
          </form>

          {/* Danger zone */}
          <div className="mt-12 pt-8 border-t border-[var(--border-color)]">
            <h3 className="font-pixel text-sm text-red-400 mb-4">DANGER ZONE</h3>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleClearNextLastReservations}
                disabled={saving || deleting || clearingNextLast}
                className="bg-[var(--bg-secondary)] border-2 border-[var(--neon-magenta)] text-[var(--neon-magenta)] px-4 py-2 rounded hover:bg-[var(--bg-secondary)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                次ラスト予約を全解除
              </button>

              <button
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-900/30 border-2 border-red-500 text-red-400 px-4 py-2 rounded hover:bg-red-900/50 transition-colors disabled:opacity-50"
              >
                {deleting ? 'DELETING...' : 'DELETE ROOM'}
              </button>
            </div>
          </div>

          {/* Decorative corners */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[var(--neon-cyan)]" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[var(--neon-cyan)]" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[var(--neon-magenta)]" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[var(--neon-magenta)]" />
        </div>
      </main>

      {/* CRT overlay */}
      <div className="crt-overlay" />
    </div>
  )
}
