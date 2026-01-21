'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewRoomPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [keyword, setKeyword] = useState('参加')
  const [partySize, setPartySize] = useState(4)
  const [rotateCount, setRotateCount] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          youtube_url: youtubeUrl,
          keyword,
          party_size: partySize,
          rotate_count: rotateCount,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error)
        return
      }

      router.push(`/rooms/${data.room.id}`)
    } catch {
      setError('ルームの作成に失敗しました')
    } finally {
      setLoading(false)
    }
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
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link 
            href="/dashboard"
            className="text-[var(--text-muted)] hover:text-[var(--neon-cyan)] transition-colors"
          >
            ← BACK
          </Link>
          <h1 className="font-pixel text-sm neon-text-cyan">NEW ROOM</h1>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-2xl mx-auto px-4 py-8 relative z-10">
        <div className="arcade-card p-8 relative">
          <h2 className="font-pixel text-lg text-white mb-6">CREATE ROOM</h2>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-900/30 border border-red-500 text-red-400 p-3 rounded text-sm">
                {error}
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
                placeholder="マリオカート参加型配信"
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
              <p className="text-[var(--text-muted)] text-xs mt-1">
                後から設定することもできます
              </p>
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
                placeholder="参加"
              />
              <p className="text-[var(--text-muted)] text-xs mt-1">
                このキーワードをコメントしたユーザーを自動登録します
              </p>
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
              disabled={loading}
              className="arcade-btn w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'CREATING...' : 'CREATE ROOM'}
            </button>
          </form>

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
