#!/usr/bin/env bash
# 一键部署（Linux / macOS）
#   ./scripts/deploy.sh            # 构建并启动
#   ./scripts/deploy.sh --skip-build
#   ./scripts/deploy.sh --logs
#   ./scripts/deploy.sh --down
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --logs) docker compose --env-file .env logs -f --tail=100; exit 0 ;;
    --down) docker compose --env-file .env down; exit 0 ;;
    *) echo "未知参数：$arg"; exit 1 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker 未运行，请先启动 Docker 后重试" >&2
  exit 1
fi

# 1. 准备 .env
if [ ! -f .env ]; then
  cp .env.deploy.example .env
  secret="$(openssl rand -base64 32 | tr -d '\n')"
  if sed --version >/dev/null 2>&1; then
    sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=${secret}|" .env
  else
    sed -i '' "s|^AUTH_SECRET=.*|AUTH_SECRET=${secret}|" .env
  fi
  echo "[init] 已生成 .env 并写入随机 AUTH_SECRET"
  echo "       请检查 MYSQL_ROOT_PASSWORD / OPERATOR_PASSWORD / INGEST_PROXY"
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a
WEB_PORT="${WEB_PORT:-8081}"
API_PORT="${API_PORT:-18080}"

# 2. 构建并启动
if [ "$SKIP_BUILD" -eq 1 ]; then
  docker compose --env-file .env up -d
else
  docker compose --env-file .env up -d --build
fi

# 3. 等待健康
echo "[wait] 等待服务就绪（首次构建 + 导入种子约 1-3 分钟）"
ready=0
for i in $(seq 1 60); do
  sleep 3
  web="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT}/healthz" || true)"
  api="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${API_PORT}/api/v1/health" || true)"
  echo "  [$((i * 3))s] web=${web} api=${api}"
  if [ "$web" = "200" ] && [ "$api" = "200" ]; then ready=1; break; fi
done

if [ "$ready" -ne 1 ]; then
  echo "等待超时，排查：docker compose logs -f backend" >&2
  exit 1
fi

echo
echo "部署完成"
echo "  前端      http://127.0.0.1:${WEB_PORT}"
echo "  运营后台  http://127.0.0.1:${WEB_PORT}/admin"
echo "  接口      http://127.0.0.1:${API_PORT}/api/v1/health"
echo
echo "  默认账号  operator /（.env 里的 OPERATOR_PASSWORD）"
