#!/bin/bash
#
# EPARK Dental RPA デプロイスクリプト
#
# 使用方法:
#   ./scripts/deploy-smartcall-epark-dental.sh
#
# 前提条件:
#   - SSH鍵 (~/.ssh/milestone) が設定されていること
#   - RPA01サーバーに/home/alma/smartcall-epark-dentalが存在すること
#
# 処理内容:
#   1. ローカルリポジトリの状態確認
#   2. ソースコードをtarballに圧縮
#   3. ステージングサーバー経由でRPAサーバーに転送
#   4. RPAサーバーでファイルを展開
#   5. Dockerイメージをビルド・再起動
#

set -e

# 色付き出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 設定
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_PATH="$(dirname "$SCRIPT_DIR")"
STAGING_SERVER="centos@153.126.214.207"
RPA_SERVER="alma@192.168.20.70"
RPA_REMOTE_PATH="/home/alma/smartcall-epark-dental"
SSH_KEY="$HOME/.ssh/milestone"
TEMP_DIR="/tmp"
TARBALL_NAME="smartcall-epark-dental.tar.gz"
CONTAINER_NAME="smartcall-epark-dental"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}EPARK Dental RPA デプロイスクリプト${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "ローカルパス: $LOCAL_PATH"
echo -e "リモートパス: $RPA_REMOTE_PATH"

# 1. ローカルリポジトリの確認
echo -e "\n${YELLOW}[1/6] ローカルリポジトリの確認${NC}"
if [ ! -d "$LOCAL_PATH" ]; then
    echo -e "${RED}エラー: ローカルリポジトリが見つかりません: $LOCAL_PATH${NC}"
    exit 1
fi

cd "$LOCAL_PATH"

# Gitステータスの確認
if [ -d ".git" ]; then
    if [ -n "$(git status --porcelain)" ]; then
        echo -e "${YELLOW}警告: コミットされていない変更があります${NC}"
        git status --short
        read -p "続行しますか？ (y/N): " confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            echo "キャンセルしました"
            exit 0
        fi
    fi

    # 現在のコミットを表示
    CURRENT_COMMIT=$(git log -1 --format='%h %s' 2>/dev/null || echo "N/A")
    echo -e "現在のコミット: ${GREEN}$CURRENT_COMMIT${NC}"
else
    echo -e "${YELLOW}警告: Gitリポジトリではありません${NC}"
    CURRENT_COMMIT="N/A"
fi

# 2. GitHubから最新を取得（SKIP_GIT_SYNC=1 でスキップ可能）
echo -e "\n${YELLOW}[2/6] GitHubとの同期確認${NC}"
if [ "${SKIP_GIT_SYNC:-0}" = "1" ]; then
    echo -e "${YELLOW}SKIP_GIT_SYNC=1 が設定されているため、Git同期をスキップします${NC}"
elif [ -d ".git" ]; then
    git fetch origin 2>/dev/null || true
    LOCAL_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")
    REMOTE_HASH=$(git rev-parse origin/main 2>/dev/null || echo "")

    if [ -n "$LOCAL_HASH" ] && [ -n "$REMOTE_HASH" ] && [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
        echo -e "${YELLOW}警告: ローカルとリモートに差分があります${NC}"
        echo "ローカル: $LOCAL_HASH"
        echo "リモート: $REMOTE_HASH"
        read -p "git pull を実行しますか？ (y/N): " confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            git pull origin main
        fi
    else
        echo -e "${GREEN}GitHubと同期済み${NC}"
    fi
else
    echo -e "${YELLOW}Gitリポジトリではないためスキップ${NC}"
fi

# 3. tarball作成
echo -e "\n${YELLOW}[3/6] ソースコードをtarballに圧縮${NC}"
cd "$LOCAL_PATH"
tar -czf "$TEMP_DIR/$TARBALL_NAME" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist' \
    --exclude='screenshots/*' \
    --exclude='input/*' \
    --exclude='output/*' \
    .
echo -e "作成完了: $TEMP_DIR/$TARBALL_NAME"
ls -lh "$TEMP_DIR/$TARBALL_NAME"

# 4. ステージングサーバーに転送
echo -e "\n${YELLOW}[4/6] ステージングサーバーに転送${NC}"
scp -i "$SSH_KEY" "$TEMP_DIR/$TARBALL_NAME" "$STAGING_SERVER:$TEMP_DIR/"
echo -e "${GREEN}ステージングサーバーへの転送完了${NC}"

# 5. ステージングサーバーからRPAサーバーに転送・展開
echo -e "\n${YELLOW}[5/6] RPAサーバーに転送・展開${NC}"

# RPAサーバーに転送
ssh -i "$SSH_KEY" "$STAGING_SERVER" "scp -i ~/.ssh/milestone $TEMP_DIR/$TARBALL_NAME $RPA_SERVER:$TEMP_DIR/"
echo -e "RPAサーバーへの転送完了"

# RPAサーバーで展開
ssh -i "$SSH_KEY" "$STAGING_SERVER" "ssh -i ~/.ssh/milestone $RPA_SERVER 'cd $RPA_REMOTE_PATH && tar -xzf $TEMP_DIR/$TARBALL_NAME'"
echo -e "${GREEN}tarball展開完了${NC}"

# 6. Dockerイメージビルド・コンテナ再起動
echo -e "\n${YELLOW}[6/6] Dockerイメージビルド・コンテナ再起動${NC}"

# docker-compose.prod.ymlでビルド＆再起動
ssh -i "$SSH_KEY" "$STAGING_SERVER" "ssh -i ~/.ssh/milestone $RPA_SERVER 'cd $RPA_REMOTE_PATH && sudo docker compose -f docker-compose.prod.yml build'"
echo -e "Dockerイメージビルド完了"

ssh -i "$SSH_KEY" "$STAGING_SERVER" "ssh -i ~/.ssh/milestone $RPA_SERVER 'cd $RPA_REMOTE_PATH && sudo docker compose -f docker-compose.prod.yml up -d'"
echo -e "${GREEN}コンテナ起動完了${NC}"

# コンテナ状態確認
echo -e "\nコンテナ状態の確認:"
sleep 3
ssh -i "$SSH_KEY" "$STAGING_SERVER" "ssh -i ~/.ssh/milestone $RPA_SERVER 'sudo docker ps --filter name=$CONTAINER_NAME --format \"table {{.Names}}\t{{.Status}}\t{{.Ports}}\"'"

# ヘルスチェック
echo -e "\n${YELLOW}ヘルスチェック実行中...${NC}"
sleep 5
HEALTH_RESULT=$(ssh -i "$SSH_KEY" "$STAGING_SERVER" "ssh -i ~/.ssh/milestone $RPA_SERVER 'curl -s http://localhost:3001/health'" 2>/dev/null || echo "failed")
if echo "$HEALTH_RESULT" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}ヘルスチェック: OK${NC}"
    echo "$HEALTH_RESULT" | jq . 2>/dev/null || echo "$HEALTH_RESULT"
else
    echo -e "${RED}ヘルスチェック: NG${NC}"
    echo "$HEALTH_RESULT"
    echo -e "\nログを確認してください:"
    echo -e "  ./scripts/logs.sh"
fi

# クリーンアップ
echo -e "\n${YELLOW}一時ファイルのクリーンアップ${NC}"
rm -f "$TEMP_DIR/$TARBALL_NAME"
ssh -i "$SSH_KEY" "$STAGING_SERVER" "rm -f $TEMP_DIR/$TARBALL_NAME"
ssh -i "$SSH_KEY" "$STAGING_SERVER" "ssh -i ~/.ssh/milestone $RPA_SERVER 'rm -f $TEMP_DIR/$TARBALL_NAME'"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}デプロイ完了！${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "デプロイしたコミット: ${GREEN}$CURRENT_COMMIT${NC}"
echo -e "\nログを確認する場合:"
echo -e "  ./scripts/logs.sh"
echo -e "\nまたは直接:"
echo -e "  ssh -i ~/.ssh/milestone centos@153.126.214.207 \"ssh -i ~/.ssh/milestone alma@192.168.20.70 'sudo docker logs --tail 50 $CONTAINER_NAME'\""
