# SmartCall RPA API用 Dockerfile

# Playwright公式イメージ（ブラウザ込み）
FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# 依存関係のインストール（キャッシュ効率化のため先にコピー）
COPY package*.json ./
RUN npm ci

# アプリケーションコードをコピー
COPY . .

# TypeScriptの場合はビルド
RUN chmod +x ./node_modules/.bin/tsc
RUN npm run build

# ヘルスチェック用のcurlをインストール
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# ヘルスチェック（/healthエンドポイントが必要）
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# アプリケーションポート
EXPOSE 3000

# アプリケーション起動
CMD ["npm", "run", "start"]
