'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error)
        return
      }

      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background grid */}
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0, 255, 245, 0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0, 255, 245, 0.3) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}
      />
      
      {/* Gradient orbs */}
      <div className="absolute top-1/4 -left-20 w-80 h-80 bg-[var(--neon-cyan)] rounded-full opacity-20 blur-[100px]" />
      <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-[var(--neon-magenta)] rounded-full opacity-20 blur-[100px]" />

      <div className="arcade-card p-8 w-full max-w-md relative z-10">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="font-pixel text-xl neon-text-cyan animate-pulse-glow mb-2">
            QUEUE
          </h1>
          <h2 className="font-pixel text-sm neon-text-magenta">
            MANAGER
          </h2>
          <p className="text-[var(--text-secondary)] mt-4 text-sm">
            参加者キューマネージャー
          </p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-900/30 border border-red-500 text-red-400 p-3 rounded text-sm">
              {error}
            </div>
          )}
          
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="arcade-input"
              placeholder="your@email.com"
              required
            />
          </div>
          
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="arcade-input"
              placeholder="••••••••"
              required
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="arcade-btn w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'LOADING...' : 'START'}
          </button>
        </form>
        
        <div className="mt-6 text-center">
          <p className="text-[var(--text-muted)] text-sm">
            アカウントをお持ちでない方
          </p>
          <Link 
            href="/register" 
            className="inline-block mt-2 text-[var(--neon-magenta)] hover:underline text-sm font-medium"
          >
            → 新規登録
          </Link>
        </div>

        {/* Decorative corners */}
        <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[var(--neon-cyan)]" />
        <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[var(--neon-cyan)]" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[var(--neon-magenta)]" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[var(--neon-magenta)]" />
      </div>

      {/* CRT overlay */}
      <div className="crt-overlay" />
    </div>
  )
}
