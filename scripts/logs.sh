#!/bin/bash
# ==============================================
# 常駐RPAサーバー ログ表示スクリプト
# ==============================================
# Usage: ./scripts/logs.sh [-f] [--tail N]
#
# オプション:
#   -f, --follow    ログをリアルタイムで表示
#   --tail N        最新N行のみ表示（デフォルト: 100）

set -e

FOLLOW=""
TAIL="100"

while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--follow)
            FOLLOW="-f"
            shift
            ;;
        --tail)
            TAIL="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

if docker ps --format '{{.Names}}' | grep -q '^smartcall-epark-dental$'; then
    docker logs $FOLLOW --tail "$TAIL" smartcall-epark-dental
else
    echo "コンテナが起動していません"
    echo ""
    echo "起動するには:"
    echo "  ./scripts/start.sh"
    exit 1
fi
