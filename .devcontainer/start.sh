#!/usr/bin/env bash
# 每次 Codespace 启动时执行：拉起 docker compose 栈
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "[start] Docker 未就绪，跳过自动启动；稍后手动执行：docker compose --env-file .env up -d --build"
  exit 0
fi

echo "[start] 启动 docker compose（首次会构建镜像，5–10 分钟）…"
docker compose --env-file .env up -d --build

echo "[start] 等待服务就绪…"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8081/healthz >/dev/null 2>&1; then
    echo "[start] 前端已就绪：http://127.0.0.1:8081（Codespaces 会自动转发端口）"
    break
  fi
  sleep 5
done

docker compose ps
