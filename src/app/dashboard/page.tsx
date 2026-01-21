'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Room {
  id: string
  name: string
  party_size: number
  is_monitoring: boolean
  participants: { count: number }[]
  waiting_queue: { count: number }[]
}

export default function DashboardPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const router = useRouter()
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const res = await fetch('/api/rooms')
        if (res.ok) {
          const data = await res.json()
          setRooms(data.rooms || [])
        }
      } catch (err) {
        console.error('Failed to fetch rooms:', err)
      } finally {
        setLoading(false)
      }
    }

    if (!authLoading && user) {
      fetchRooms()
    }
  }, [authLoading, user])

  const handleLogout = async () => {
    await logout()
    router.push('/login')
    router.refresh()
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
          <div className="flex items-center gap-3">
            <h1 className="font-pixel text-sm neon-text-cyan">QUEUE</h1>
            <span className="font-pixel text-xs neon-text-magenta">MANAGER</span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-[var(--text-secondary)] text-sm flex items-center gap-2">
              <span className="w-2 h-2 bg-[var(--neon-green)] rounded-full animate-pulse" />
              {user?.user_metadata?.display_name || user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--neon-magenta)] transition-colors"
            >
              LOGOUT
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 py-8 relative z-10">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="font-pixel text-lg text-white mb-2">MY ROOMS</h2>
            <p className="text-[var(--text-secondary)] text-sm">配信ルームを管理</p>
          </div>
          <Link
            href="/rooms/new"
            className="arcade-btn"
          >
            + NEW ROOM
          </Link>
        </div>

        {rooms.length === 0 ? (
          /* Empty state */
          <div className="arcade-card p-12 text-center">
            <div className="font-pixel text-4xl mb-4 opacity-20">?</div>
            <p className="text-[var(--text-secondary)] mb-6">
              ルームがまだありません
            </p>
            <p className="text-[var(--text-muted)] text-sm mb-8">
              新規ルームを作成して配信を始めましょう
            </p>
            <Link
              href="/rooms/new"
              className="arcade-btn arcade-btn-secondary inline-block"
            >
              CREATE ROOM
            </Link>
          </div>
        ) : (
          /* Room list */
          <div className="grid gap-4">
            {rooms.map((room) => {
              const participantCount = room.participants?.[0]?.count || 0
              const waitingCount = room.waiting_queue?.[0]?.count || 0
              
              return (
                <Link
                  key={room.id}
                  href={`/rooms/${room.id}`}
                  className="arcade-card p-6 flex justify-between items-center group"
                >
                  <div className="flex items-center gap-4">
                    <div className="text-2xl">🎮</div>
                    <div>
                      <h3 className="text-white font-medium mb-1 group-hover:text-[var(--neon-cyan)] transition-colors">
                        {room.name}
                      </h3>
                      <div className="flex gap-4 text-sm text-[var(--text-muted)]">
                        <span>
                          パーティー: <span className="text-[var(--neon-green)]">{participantCount}</span>/{room.party_size}人
                        </span>
                        <span>
                          待機: <span className="text-[var(--neon-yellow)]">{waitingCount}</span>人
                        </span>
                        <span className="flex items-center gap-1">
                          監視: 
                          {room.is_monitoring ? (
                            <span className="text-[var(--neon-green)] flex items-center gap-1">
                              <span className="w-2 h-2 bg-[var(--neon-green)] rounded-full animate-pulse" />
                              ON
                            </span>
                          ) : (
                            <span className="text-[var(--text-muted)]">OFF</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-[var(--text-muted)] group-hover:text-[var(--neon-cyan)] transition-colors">
                    →
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>

      {/* CRT overlay */}
      <div className="crt-overlay" />
    </div>
  )
}
