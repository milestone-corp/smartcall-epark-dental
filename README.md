# SmartCall EPARK Dental

EPARKの歯医者予約システムをSmartCallを用いて、予約管理をRPAにて自動化するプロジェクトです。

## 機能

- 空き枠の取得
- 予約の作成
- 予約のキャンセル

## セットアップ

```bash
# 依存関係をインストール
npm install

# 環境変数を設定
cp .env.example .env
# .env を編集してログインID/パスワードを設定

# ローカル開発（スタブモード）
npm run dev
```

## ディレクトリ構成

```
smartcall-epark-dental/
├── Dockerfile          # デプロイ用
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts        # エントリポイント
│   ├── server.ts       # Expressサーバー
│   ├── worker.ts       # BullMQ Worker
│   └── pages/          # Page Objects
│       └── LoginPage.ts
└── screenshots/        # スクリーンショット保存先
```

## デプロイ

1. GitHubにプッシュ
2. [開発者ポータル](https://dev-portal.smartcall.jp)からデプロイ

## 環境変数

| 変数名 | 説明 |
|--------|------|
| `PORT` | サーバーポート（デフォルト: 3000） |
| `LOGIN_KEY` | ログインID |
| `LOGIN_PASSWORD` | ログインパスワード |
| `SMARTCALL_MODE` | 動作モード（stub: ローカル開発） |
