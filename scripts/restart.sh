#!/bin/bash
# ==============================================
# 常駐RPAサーバー 再起動スクリプト
# ==============================================
# Usage: ./scripts/restart.sh
#
# Docker Composeを使用して常駐RPAサーバーを再起動します。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=========================================="
echo "常駐RPAサーバー 再起動"
echo "=========================================="

# 停止
if docker ps --format '{{.Names}}' | grep -q '^smartcall-epark-dental$'; then
    echo "コンテナを停止しています..."
    docker compose down
fi

# 起動
echo "Dockerイメージをビルドしています..."
docker compose build

echo "コンテナを起動しています..."
docker compose up -d

echo ""
echo "=========================================="
echo "再起動完了"
echo "=========================================="
echo "ポート: 3000"
echo "ヘルスチェック: http://localhost:3000/health"
echo ""
echo "ログを確認するには:"
echo "  docker logs -f smartcall-epark-dental"
echo "=========================================="
