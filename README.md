# YouTube Queue Manager

YouTube参加型ライブ配信の参加者管理システム

![Next.js](https://img.shields.io/badge/Next.js-16.1-black)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green)
![Vercel](https://img.shields.io/badge/Vercel-Ready-blue)

## 概要

YouTubeライブ配信で視聴者参加型のゲーム配信を行う際に、参加者のキュー管理を自動化するWebアプリケーションです。パーティーメンバーと待機リストを管理し、YouTubeコメントから自動で参加者を登録できます。

## 主な機能

### 認証
- ユーザー登録・ログイン
- 複数の配信者が各自のアカウントで管理可能

### ルーム管理
- ライブ配信ルームの作成・編集・削除
- パーティー人数設定（1〜20人）
- 1回の交代人数設定

### 参加者管理
- **単一入力フォーム**: 空きがあれば参加者へ、満員なら待機リストへ自動振り分け
- 手動での追加・削除
- 重複チェック（既に参加/待機している場合は警告）

### 交代機能
- ボタン一つで参加者と待機者を入れ替え
- 退出した参加者は待機リストの末尾に自動追加
- 交代人数が待機者より多い場合は実際の人数を表示

### パーティー人数の動的調整
- **縮小時**: 溢れた参加者を待機リストの先頭に自動移動
- **拡大時**: 待機リストの上位を参加者に自動昇格

### YouTube連携
- YouTube配信URLとキーワードを設定
- 特定キーワードをコメントしたユーザーを自動登録
- 10秒間隔でのポーリング（クライアントサイド）
- 監視ON/OFF切り替え

### デザイン
- **Retro-Gaming / Arcade** テーマ
- ネオンカラー（シアン/マゼンタ）
- ピクセルフォント（Press Start 2P）
- CRTスキャンライン効果
- 完全楽観的UI（カクつきなし）

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | Next.js 14 (App Router) + React |
| Styling | Tailwind CSS |
| Backend | Next.js API Routes |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Deploy | Vercel |
| Font | Press Start 2P, Noto Sans JP |

## セットアップ

### 1. 前提条件

- Node.js 20以上
- Supabaseアカウント
- YouTube Data API v3 キー

### 2. Supabaseプロジェクト作成

1. [Supabase](https://supabase.com) でプロジェクト作成（推奨名: `youtube-queue-manager`）
2. Project Settings → API で以下を取得:
   - Project URL
   - Publishable key (anon key)
   - Secret key (service_role)

### 3. データベースセットアップ

Supabase の SQL Editor で以下を実行:

```bash
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_add_youtube_polling_state.sql
```

### 4. 環境変数設定

`.env.local` を作成し、以下を設定:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_secret_key

# YouTube Data API v3
YOUTUBE_API_KEY=your_youtube_api_key
```

### 5. インストール・起動

```bash
npm install
npm run dev
```

http://localhost:3000 でアクセス

## 使い方

### 初回セットアップ
1. `/register` で新規登録
2. ダッシュボードから「NEW ROOM」でルーム作成
3. ルーム設定でYouTube配信URLとキーワードを設定

### 配信中の運用
1. ルーム管理画面を開く
2. YouTube監視を「ON」にする
3. 視聴者が指定キーワードをコメント → 自動で参加者/待機リストに追加
4. 手動でも「ADD PLAYER」から追加可能
5. 「🔄 交代する」で参加者を入れ替え（退出者は待機リストへ）

## ディレクトリ構造

```
youtube-queue-manager/
├── src/
│   ├── app/
│   │   ├── api/                 # API Routes
│   │   │   ├── auth/            # 認証API
│   │   │   └── rooms/           # ルーム管理API
│   │   ├── login/               # ログイン画面
│   │   ├── register/            # 新規登録画面
│   │   ├── dashboard/           # ダッシュボード
│   │   └── rooms/               # ルーム画面
│   ├── lib/
│   │   ├── supabase/            # Supabaseクライアント
│   │   ├── youtube.ts           # YouTube URL解析
│   │   └── youtubeApi.ts        # YouTube API連携
│   └── hooks/
│       └── useAuth.ts           # 認証Hook
├── supabase/
│   └── migrations/              # DBマイグレーション
├── docs/
│   └── DESIGN.md                # 設計書
└── .env.local                   # 環境変数（gitignore）
```

## デプロイ（Vercel）

### 1. Vercelプロジェクト作成

```bash
# Vercel CLIでデプロイ
npm i -g vercel
vercel
```

### 2. 環境変数設定

Vercel Dashboard → Settings → Environment Variables で以下を設定:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `YOUTUBE_API_KEY`

### 3. デプロイ

```bash
vercel --prod
```

## YouTube API クォータ

YouTube Data API v3 の無料枠: **10,000クォータ/日**

- コメント取得（liveChatMessages.list）: 約5クォータ/回
- 10秒ポーリング × 1時間 = 360回 = 約1,800クォータ
- 目安: **5時間の配信で約9,000クォータ消費**

## トラブルシューティング

### ログインできない
- Supabase Dashboard → Authentication → Providers → Email で「Confirm email」をOFFに

### YouTube監視が動かない
- YouTube URLが配信中のものか確認
- `.env.local` に `YOUTUBE_API_KEY` が設定されているか確認
- ブラウザのコンソールでエラーを確認

### ビルドエラー
```bash
npm run lint
npm run build
```

## ライセンス

MIT

## 開発者

Created with Factory (Droid AI) + Claude Opus 4.5
