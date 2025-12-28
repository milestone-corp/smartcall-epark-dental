# SmartCall EPARK Dental

EPARKの歯医者予約システムをSmartCallを用いて、予約管理をRPAにて自動化するプロジェクトです。

## 機能

- 空き枠の取得
- 予約の検索（電話番号で検索）
- 予約の作成
- 予約のキャンセル

## セットアップ

```bash
# 依存関係をインストール
npm install

# 環境変数を設定
cp .env.example .env
# .env を編集してログインID/パスワードを設定

# 常駐サーバーを起動
npm run start:persistent
```

## APIエンドポイント

すべてのエンドポイントは以下の認証ヘッダーが必要です：

| ヘッダー | 説明 |
|----------|------|
| `X-RPA-Login-Id` | EPARKログインID |
| `X-RPA-Login-Password` | EPARKパスワード |
| `X-RPA-Shop-Id` | EPARK店舗ID |
| `X-RPA-Test-Mode` | `true`に設定するとスクリーンショットを返す（オプション） |

### GET /health

ヘルスチェック

**レスポンス:**
```json
{
  "status": "ok",
  "session_state": "ready",
  "has_credentials": true,
  "shop_id": "example_shop"
}
```

### GET /status

詳細ステータス

**レスポンス:**
```json
{
  "session": {
    "state": "ready",
    "last_activity": "2025-12-28T10:00:00.000Z",
    "shop_id": "example_shop"
  },
  "config": {
    "keep_alive_interval_ms": 300000,
    "request_timeout_ms": 600000
  }
}
```

### GET /slots

空き枠を取得

**パラメータ:**
| パラメータ | 必須 | 説明 |
|------------|------|------|
| `date_from` | No | 開始日（YYYY-MM-DD）デフォルト: 本日 |
| `date_to` | No | 終了日（YYYY-MM-DD）デフォルト: date_fromと同じ |

**レスポンス:**
```json
{
  "success": true,
  "available_slots": [
    {
      "date": "2025-12-28",
      "time": "09:00",
      "duration_min": 30,
      "stock": 1,
      "resource_name": "チェア1"
    }
  ],
  "count": 1,
  "timing": { "total_ms": 1234 }
}
```

### GET /reservations/search

電話番号で予約を検索

**パラメータ:**
| パラメータ | 必須 | 説明 |
|------------|------|------|
| `customer_phone` | Yes | 顧客電話番号 |
| `date_from` | No | 開始日（YYYY-MM-DD）デフォルト: 本日 |
| `date_to` | No | 終了日（YYYY-MM-DD）デフォルト: date_fromと同じ |

**レスポンス:**
```json
{
  "success": true,
  "reservations": [
    {
      "appointId": "12345",
      "date": "2025-12-28",
      "time": "09:00",
      "customerName": "山田太郎",
      "customerPhone": "09012345678",
      "staffId": "staff1"
    }
  ],
  "count": 1,
  "timing": { "total_ms": 1234 }
}
```

### POST /reservations

予約を作成

**リクエストボディ:**
```json
{
  "date": "2025-12-28",
  "time": "09:00",
  "duration_min": 30,
  "customer_name": "山田太郎",
  "customer_phone": "09012345678",
  "menu_name": "初診"
}
```

**レスポンス:**
```json
{
  "success": true,
  "reservation_id": "create_1735380000000",
  "external_reservation_id": "12345",
  "timing": { "total_ms": 5678 }
}
```

### DELETE /reservations

予約をキャンセル

**リクエストボディ:**
```json
{
  "date": "2025-12-28",
  "time": "09:00",
  "customer_name": "山田太郎",
  "customer_phone": "09012345678"
}
```

**レスポンス:**
```json
{
  "success": true,
  "reservation_id": "cancel_1735380000000",
  "timing": { "total_ms": 3456 }
}
```

### POST /session/restart

セッションを再起動（ログインし直す）

**レスポンス:**
```json
{
  "success": true,
  "message": "Session restarted",
  "screenshot": "base64..."
}
```

## ディレクトリ構成

```
smartcall-epark-dental/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
├── docs/
│   └── RPA_SPEC.md          # RPA仕様書
├── scripts/
│   ├── start.sh             # 起動スクリプト
│   ├── stop.sh              # 停止スクリプト
│   ├── restart.sh           # 再起動スクリプト
│   ├── status.sh            # ステータス確認
│   └── logs.sh              # ログ表示
├── src/
│   ├── persistent-server.ts # 常駐サーバー
│   ├── lib/
│   │   └── BrowserSessionManager.ts  # セッション管理
│   └── pages/
│       ├── BasePage.ts      # 基底ページ
│       ├── LoginPage.ts     # ログインページ
│       └── AppointPage.ts   # アポイント管理台帳ページ
└── screenshots/             # スクリーンショット保存先
```

## Dockerでの起動

```bash
# 起動
./scripts/start.sh

# 停止
./scripts/stop.sh

# 再起動
./scripts/restart.sh

# ステータス確認
./scripts/status.sh

# ログ表示
./scripts/logs.sh -f
```

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|------------|
| `PORT` | サーバーポート | 3000 |
| `KEEP_ALIVE_INTERVAL_MS` | キープアライブ間隔（ms） | 300000 (5分) |
| `REQUEST_TIMEOUT_MS` | リクエストタイムアウト（ms） | 600000 (10分) |
