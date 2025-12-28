#!/bin/bash
# ==============================================
# 常駐RPAサーバー 停止スクリプト
# ==============================================
# Usage: ./scripts/stop.sh
#
# Docker Composeを使用して常駐RPAサーバーを停止します。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=========================================="
echo "常駐RPAサーバー 停止"
echo "=========================================="

if docker ps --format '{{.Names}}' | grep -q '^smartcall-epark-dental$'; then
    echo "コンテナを停止しています..."
    docker compose down
    echo ""
    echo "停止完了"
else
    echo "コンテナは起動していません"
fi

echo "=========================================="
