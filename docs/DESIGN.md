# YouTube参加型ライブ配信 参加者管理WEBアプリ - 設計書

## 1. 概要

YouTube参加型ライブ配信において、参加者のキュー管理を行うWEBアプリケーション。

### 1.1 主要機能

- ユーザー登録・ログイン（複数配信者対応）
- ライブ配信ルーム作成・管理
- パーティー人数・交代人数の設定
- 参加者の手動登録
- YouTubeコメントからの自動参加者登録（キーワード検知）
- 待機列管理と自動振り分け

---

## 2. 技術スタック

| レイヤー | 技術 | 費用 |
|---------|------|------|
| ホスティング | Vercel (Hobby) | 無料 |
| DB + 認証 | Supabase (Free) | 無料 |
| フロントエンド | Next.js 14 (App Router) | - |
| バックエンド | Next.js API Routes | - |
| スタイリング | Tailwind CSS | - |
| YouTube連携 | YouTube Data API v3 | 無料 |

---

## 3. システム構成図

```
┌──────────────────────────────────────────────┐
│                 Vercel (無料)                 │
│  ┌────────────────────────────────────────┐  │
│  │         Next.js Application            │  │
│  │   Frontend + API Routes                │  │
│  └──────────────┬─────────────────────────┘  │
└─────────────────┼────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
┌────────┐  ┌──────────┐  ┌────────────┐
│Supabase│  │Supabase  │  │YouTube API │
│Auth    │  │Database  │  │(コメント)   │
│(認証)   │  │(PostgreSQL)│ │            │
└────────┘  └──────────┘  └────────────┘
```

---

## 4. データベース設計

### 4.1 ER図

```
users (1) ──── (*) rooms (1) ──── (*) participants
                          └──── (*) waiting_queue
```

### 4.2 テーブル定義

#### users
| カラム | 型 | 説明 |
|--------|-----|------|
| id | UUID | PK |
| email | VARCHAR(255) | メールアドレス（UNIQUE） |
| password_hash | VARCHAR(255) | ハッシュ化パスワード |
| display_name | VARCHAR(100) | 表示名 |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

#### rooms
| カラム | 型 | 説明 |
|--------|-----|------|
| id | UUID | PK |
| user_id | UUID | FK → users.id |
| name | VARCHAR(200) | ルーム名 |
| youtube_url | TEXT | YouTube配信URL |
| youtube_video_id | VARCHAR(20) | 動画ID |
| keyword | VARCHAR(100) | 参加キーワード（デフォルト: 参加） |
| party_size | INTEGER | パーティー人数 |
| rotate_count | INTEGER | 1回の交代人数 |
| is_monitoring | BOOLEAN | YouTube監視中フラグ |
| last_comment_id | VARCHAR(100) | 最後に取得したコメントID |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

#### participants
| カラム | 型 | 説明 |
|--------|-----|------|
| id | UUID | PK |
| room_id | UUID | FK → rooms.id |
| youtube_username | VARCHAR(200) | YouTubeユーザー名 |
| display_name | VARCHAR(200) | 表示名 |
| joined_at | TIMESTAMP | 参加日時 |
| source | VARCHAR(20) | 登録元（manual/youtube） |

#### waiting_queue
| カラム | 型 | 説明 |
|--------|-----|------|
| id | UUID | PK |
| room_id | UUID | FK → rooms.id |
| youtube_username | VARCHAR(200) | YouTubeユーザー名 |
| display_name | VARCHAR(200) | 表示名 |
| position | INTEGER | 待機順番 |
| registered_at | TIMESTAMP | 登録日時 |
| source | VARCHAR(20) | 登録元（manual/youtube） |

---

## 5. API設計

### 5.1 認証
| メソッド | エンドポイント | 機能 |
|---------|---------------|------|
| POST | /api/auth/register | ユーザー登録 |
| POST | /api/auth/login | ログイン |
| POST | /api/auth/logout | ログアウト |

### 5.2 ルーム管理
| メソッド | エンドポイント | 機能 |
|---------|---------------|------|
| GET | /api/rooms | ルーム一覧 |
| POST | /api/rooms | ルーム作成 |
| GET | /api/rooms/[id] | ルーム詳細 |
| PUT | /api/rooms/[id] | ルーム更新 |
| DELETE | /api/rooms/[id] | ルーム削除 |

### 5.3 参加者管理
| メソッド | エンドポイント | 機能 |
|---------|---------------|------|
| GET | /api/rooms/[id]/participants | 参加者一覧 |
| POST | /api/rooms/[id]/participants | 参加者追加 |
| DELETE | /api/rooms/[id]/participants/[pid] | 参加者削除 |

### 5.4 待機列管理
| メソッド | エンドポイント | 機能 |
|---------|---------------|------|
| GET | /api/rooms/[id]/queue | 待機列一覧 |
| POST | /api/rooms/[id]/queue | 待機列追加 |
| DELETE | /api/rooms/[id]/queue/[qid] | 待機列削除 |
| POST | /api/rooms/[id]/rotate | 交代実行 |

### 5.5 YouTube連携
| メソッド | エンドポイント | 機能 |
|---------|---------------|------|
| POST | /api/rooms/[id]/youtube/start | 監視開始 |
| POST | /api/rooms/[id]/youtube/stop | 監視停止 |
| GET | /api/rooms/[id]/youtube/poll | コメント取得 |

---

## 6. 画面一覧

| 画面ID | 画面名 | パス |
|--------|--------|------|
| P01 | ログイン | /login |
| P02 | 新規登録 | /register |
| P03 | ダッシュボード | /dashboard |
| P04 | ルーム作成 | /rooms/new |
| P05 | ルーム管理 | /rooms/[id] |
| P06 | ルーム設定 | /rooms/[id]/settings |

---

## 7. 環境変数

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
YOUTUBE_API_KEY=your_youtube_api_key
```
