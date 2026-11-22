# 部署到 GitHub（Pages / Codespaces / 公网后端）

> 仓库：`https://github.com/LUCAS-LI21/LingYu`
> 目标：网页可在任意设备打开；小程序可连同一套后端。

## 一、能力边界（先说清楚）

| 方式                  | 能跑什么                                             | 适合谁                                             |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| **GitHub Pages**      | 只能托管**前端静态文件**；Spring Boot + MySQL 跑不了 | 无需登录即可浏览界面与数据                         |
| **GitHub Codespaces** | 完整前后端 + MySQL（容器里跑）                       | 需要真实数据、后台、反馈闭环的人（需 GitHub 账号） |
| **自建服务器 / PaaS** | 完整系统对外提供 HTTPS API                           | 小程序上线、多人同时使用                           |

结论：**Pages 只能解决"网站能打开"，小程序和完整功能必须有公网后端**。

## 二、GitHub Pages（自动部署前端）

1. 推送代码到 `main`（`pages.yml` 已内置）。
2. 仓库 **Settings → Pages → Build and deployment → Source = GitHub Actions**。
3. 等 Actions 里的 `Deploy Web (GitHub Pages)` 变绿。
4. 访问：`https://lucas-li21.github.io/LingYu/`

说明：

- 构建时注入 `VITE_BASE=/LingYu/`，路由与资源都在子路径下。
- 没有后端时前端自动降级到本地种子（339 条），页面顶部会出现离线提示；地图/列表/洞察可浏览，后台登录不可用。
- 静态站**不含真实库数据**，也不含任何密钥。

## 三、Codespaces（完整系统）

1. 仓库首页 **Code → Codespaces → Create codespace on main**。
2. 首次构建约 5–10 分钟（`.devcontainer` 会自动生成 `.env`、拉起 MySQL/后端/前端）。
3. 端口 `8081` 打开即系统；后台口令见 Codespaces 里 `.env` 的 `OPERATOR_PASSWORD`。
4. 需要 L2 实时层（高德）：仓库 **Settings → Secrets and variables → Codespaces** 新建 `AMAP_KEY`，然后 Rebuild Container。

## 四、公网后端（小程序上线必需）

任选一个支持 Docker 的平台（Render / Railway / Fly.io / 自己的云主机），用仓库里的：

- `backend/Dockerfile`（构建镜像）
- `docker-compose.yml`（本地/服务器编排）
- `.env.deploy.example`（必填变量清单）

关键环境变量：

```ini
DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
AUTH_SECRET=<随机 44 位>
OPERATOR_PASSWORD=<随机强口令>
AMAP_KEY=<高德 Web服务 Key，可空>
```

部署后验证：

```bash
curl https://<你的域名>/api/v1/health
```

若用 PaaS，记得把 `app.cors.origins`（环境变量 `CORS_ORIGINS`）设为你的前端域名。

## 五、小程序连公网后端

1. 后端必须是 **HTTPS** 且域名已备案（微信要求）。
2. 改 `miniprogram/config.js`：

   ```js
   const API_BASE = 'https://<你的域名>'
   ```

3. 微信公众平台 → 开发 → 开发设置 → **服务器域名 → request 合法域名** 添加该域名。
4. 重新编译上传；真机即可与网页共用同一套数据与反馈闭环。

## 六、CI 会做什么

| Workflow    | 触发             | 内容                                                          |
| ----------- | ---------------- | ------------------------------------------------------------- |
| `ci.yml`    | push / PR        | lint、类型、单测（前端 75 / 后端 32）、e2e、构建镜像并推 GHCR |
| `pages.yml` | push main / 手动 | 构建前端（`/LingYu/`）并发布 GitHub Pages                     |

## 七、常见问题

| 现象                  | 原因                                           | 处理                                                                      |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| Pages 打开是空白      | Pages Source 没设为 GitHub Actions，或构建失败 | 看 Actions 日志；确认 `VITE_BASE=/LingYu/`                                |
| Pages 顶部提示离线    | 正常：没有后端                                 | 用 Codespaces 或自建后端                                                  |
| Codespaces 端口打不开 | 首次构建未完成                                 | 等 `start.sh` 跑完，或手动 `docker compose --env-file .env up -d --build` |
| 小程序请求失败        | 域名未配置 / 非 HTTPS / 未备案                 | 按第五节配置合法域名                                                      |
