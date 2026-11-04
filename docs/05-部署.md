# ⑤ 部署

> 目标：任何环境**一条命令**起服务，发版可重复、可回滚、可观测。

## 用到的工具

| 工具              | 作用                       | 为什么选它                            |
| ----------------- | -------------------------- | ------------------------------------- |
| Docker 多阶段构建 | 构建产物与运行环境分离     | 镜像只含静态文件和 Nginx，通常 < 60MB |
| Nginx             | 静态托管 + SPA 回退 + 反代 | 最稳的静态服务方案，配置透明          |
| GitHub Actions    | CI/CD                      | 与仓库原生集成，免费额度够用          |
| GHCR              | 镜像仓库                   | 免额外账号，权限跟仓库走              |

## 构建与运行

```bash
# 本地构建镜像并起服务（前端 8081，后端按需）
docker compose up -d --build

# 只起前端
docker compose up -d web

# 带后端一起（需先放好 backend/target/app.jar）
docker compose --profile backend up -d --build

# 看日志 / 停服
docker compose logs -f web
docker compose down
```

## Nginx 配置要点

见 `docker/nginx.conf`：

- `/assets/*` → 一年强缓存 + `immutable`（文件名带 hash，天然安全）。
- `index.html` → 不缓存，保证发版立即生效。
- `/api/*` → 反代到 `backend:8080`，用运行时 DNS 解析，后端没起也不会拖垮 Nginx。
- `/healthz` → 健康检查，给 Docker HEALTHCHECK 和 K8s probe 复用。
- SPA 回退：`try_files $uri $uri/ /index.html`，刷新子路由不 404。

## CI/CD 流水线

`.github/workflows/ci.yml` 分三个 job：

1. **quality**：Lint → 格式 → 类型 → 单测 → 构建，产出 `dist` 工件。
2. **e2e**：装 Chromium，跑 Playwright，失败时上传报告。
3. **deploy**：仅 `main` 分支推送时构建镜像并推到 GHCR。

镜像同时打 `latest` 与提交 SHA 两个标签，回滚就是重新部署上一个 SHA。

## 回滚与灰度

- 回滚：`docker compose` 里把 image 换成上一个 sha，或 `docker pull` 后重启。
- 灰度：Nginx 按权重分流到两个版本容器；或用反向代理的 `split_clients`。
- 前端发版不缓存入口 HTML，因此**回滚只需换静态文件**，不涉及数据库。

## 验收清单

- [ ] `docker compose up -d --build` 后 `/healthz` 返回 `ok`
- [ ] 直接访问 `/board` 刷新不 404
- [ ] 改接口地址只需改 `.env`，不改代码
- [ ] 镜像不含 `node_modules`（多阶段构建已保证）
