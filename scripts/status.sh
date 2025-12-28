#!/bin/bash
# ==============================================
# 常駐RPAサーバー ステータス確認スクリプト
# ==============================================
# Usage: ./scripts/status.sh
#
# コンテナの状態とヘルスチェックを実行します。

set -e

echo "=========================================="
echo "常駐RPAサーバー ステータス"
echo "=========================================="

# コンテナ状態
echo ""
echo "■ コンテナ状態:"
if docker ps --format '{{.Names}}' | grep -q '^smartcall-epark-dental$'; then
    docker ps --filter name=smartcall-epark-dental --format "  名前: {{.Names}}\n  状態: {{.Status}}\n  ポート: {{.Ports}}"

    # ヘルスチェック
    echo ""
    echo "■ ヘルスチェック:"
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        HEALTH_RESPONSE=$(curl -s http://localhost:3000/health)
        echo "  結果: OK"
        echo "  レスポンス: $HEALTH_RESPONSE"
    else
        echo "  結果: NG（エンドポイントに接続できません）"
    fi

    # セッション状態
    echo ""
    echo "■ セッション状態:"
    SESSION_RESPONSE=$(curl -s http://localhost:3000/session/status 2>/dev/null || echo '{"error": "接続できません"}')
    echo "  $SESSION_RESPONSE"
else
    echo "  コンテナは起動していません"
fi

echo ""
echo "=========================================="
