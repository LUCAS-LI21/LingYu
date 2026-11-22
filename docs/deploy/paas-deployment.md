# PaaS 部署（Render / Railway / Fly.io）

目标：获得公网 HTTPS API，供网站与微信小程序共用。

## 前置条件

1. 一个支持 Docker 的 PaaS 账号（Render、Railway 或 Fly.io）。
2. 一个公网 MySQL 8.0 实例（如 Aiven、PlanetScale、TiDB Cloud 的免费档）。
3. 后端镜像使用仓库内 `backend/Dockerfile`。

## Render（Blueprint）

仓库根目录已提供 [render.yaml](../render.yaml)。

1. Render 控制台 → **New → Blueprint**，连接本仓库。
2. 按提示填写 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`OPERATOR_PASSWORD`、`AMAP_KEY`（可空）。
3. 部署完成后访问 `https://<service>.onrender.com/api/v1/health`，应返回 HTTP 200。
4. 首次启动自动执行 `db/migration` 下的迁移脚本。

> 免费实例长时间无请求会休眠，首次唤醒约 30 秒；正式演示建议升级到付费实例。

## Railway / Fly.io

- Railway：新建项目 → Deploy from GitHub → 选择仓库，Root Directory 设为 `backend`，变量同上。
- Fly.io：`fly launch --dockerfile backend/Dockerfile`，再 `fly secrets set DB_HOST=... AUTH_SECRET=...`。

## 小程序接入

1. 后端域名必须为 HTTPS，并完成 ICP 备案（微信要求）。
2. 修改 `miniprogram/config.js`：

   ```js
   const API_BASE = 'https://<你的域名>'
   ```

3. 微信公众平台 → 开发 → 开发设置 → **服务器域名 → request 合法域名** 添加该域名。
4. 重新编译上传，真机即可访问。

## 验证清单

| 项                        | 预期                       |
| ------------------------- | -------------------------- |
| `GET /api/v1/health`      | HTTP 200                   |
| `GET /api/v1/pois?size=1` | 返回 1 条数据              |
| `POST /api/v1/feedback`   | 返回受理编号               |
| 管理后台登录              | `operator` + 自定义口令    |
| 小程序真机                | 地图、列表、详情、反馈可用 |
