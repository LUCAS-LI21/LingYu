#!/usr/bin/env bash
# Codespaces 首次创建时执行：生成 .env（随机口令）并准备数据
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo "[setup] .env 已存在，跳过生成"
  exit 0
fi

# 随机口令：运营口令、数据库口令、AUTH_SECRET
gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
OPERATOR_PASSWORD="$(gen 20)"
DB_PASSWORD="$(gen 16)"
AUTH_SECRET="$(gen 44)"
MYSQL_ROOT_PASSWORD="$(gen 20)"

# Codespaces Secrets 会以环境变量注入：有就带进 .env，没有就留空（前端显示「未配置」）
AMAP_KEY_VALUE="${AMAP_KEY:-}"
DEEPSEEK_KEY_VALUE="${DEEPSEEK_API_KEY:-}"

cat > .env <<EOF
# 由 .devcontainer/setup.sh 生成（每次创建 Codespace 都不同）
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
DB_NAME=poi_intel
DB_USER=poi
DB_PASSWORD=${DB_PASSWORD}

AUTH_SECRET=${AUTH_SECRET}
OPERATOR_USERNAME=operator
OPERATOR_PASSWORD=${OPERATOR_PASSWORD}
APP_AUTH_ALLOW_DEFAULT_PASSWORD=false

INGEST_PROXY=
# 来自 Codespaces Secrets（仓库 Settings → Secrets and variables → Codespaces）
AMAP_KEY=${AMAP_KEY_VALUE}
DEEPSEEK_API_KEY=${DEEPSEEK_KEY_VALUE}
LIVE_DAILY_BUDGET=300
LIVE_DAILY_BUDGET_AROUND=100
LIVE_MIN_INTERVAL_MS=200

WEB_PORT=8081
WEB_SSL_PORT=8443
API_PORT=18080
MYSQL_PORT=3307
EOF

if [ -n "${AMAP_KEY_VALUE}" ]; then
  echo "[setup] 已从 Codespaces Secrets 注入 AMAP_KEY（L2 实时层可用）"
else
  echo "[setup] 未检测到 AMAP_KEY：L2 实时层显示「未配置」，本地库功能不受影响"
fi

echo "[setup] 已生成 .env"
echo "[setup] 运营账号：operator / ${OPERATOR_PASSWORD}"
echo "[setup] （这个口令保存在 .env，评委可在 Codespaces 文件树里查看）"
