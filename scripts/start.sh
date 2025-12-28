#!/bin/bash
# ==============================================
# 常駐RPAサーバー 起動スクリプト
# ==============================================
# Usage: ./scripts/start.sh
#
# Docker Composeを使用して常駐RPAサーバーを起動します。
# Playwrightブラウザがプリインストールされた公式イメージを使用。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=========================================="
echo "常駐RPAサーバー 起動"
echo "=========================================="
echo "ディレクトリ: $PROJECT_DIR"
echo ""

# .envファイルの存在確認
if [ ! -f ".env" ]; then
    echo "エラー: .envファイルが見つかりません"
    echo ".env.exampleを参考に.envファイルを作成してください"
    exit 1
fi

# 既存のコンテナがあれば停止
if docker ps -a --format '{{.Names}}' | grep -q '^smartcall-epark-dental$'; then
    echo "既存のコンテナを停止・削除します..."
    docker compose down
fi

# イメージをビルドして起動
echo "Dockerイメージをビルドしています..."
docker compose build

echo "コンテナを起動しています..."
docker compose up -d

echo ""
echo "=========================================="
echo "起動完了"
echo "=========================================="
echo "ポート: 3000"
echo "ヘルスチェック: http://localhost:3000/health"
echo ""
echo "ログを確認するには:"
echo "  docker logs -f smartcall-epark-dental"
echo ""
echo "停止するには:"
echo "  ./scripts/stop.sh"
echo "=========================================="
