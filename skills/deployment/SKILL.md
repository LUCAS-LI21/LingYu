---
name: deployment
description: 在部署发布阶段使用。当需要把系统跑起来（本地/服务器/容器）、设计 CI/CD 流水线、做发布与回滚、或排查"本地能跑线上不行"时触发。强调 12-Factor、健康检查与可回滚。
---

# 部署 Skill

## 何时用

- 第一次要把系统部署到目标机器。
- 每次发版。
- 线上出问题要回滚。

## 铁律

1. **一次构建，多环境运行**：同一镜像，配置靠环境变量注入（12-Factor III）。
2. **没有健康检查的部署等于盲发**：`/healthz` 必须覆盖 DB 连通性。
3. **回滚要比发布快**：镜像打 sha 标签，回滚 = 换标签重启。
4. **数据要能备份**：上线前先确认备份与恢复步骤。

## 步骤

### 1. 环境准备

- 记录目标机：OS、CPU/内存、磁盘、Docker 版本、端口占用。
- 本项目：Docker Desktop 若不可用，提供「非容器启动」兜底脚本。

### 2. 镜像构建

```dockerfile
FROM maven:3.9-eclipse-temurin-17 AS build
# 依赖缓存层 → 源码层 → 打包层
FROM eclipse-temurin:17-jre
# 非 root 用户、健康检查、时区
```

- 多阶段构建，运行镜像不含 Maven/源码。
- 前端：`node` 构建 → `nginx` 托管，入口 HTML 不缓存、静态资源长缓存。

### 3. 编排（docker compose）

- 服务：`mysql` / `backend` / `frontend`。
- `depends_on` + healthcheck 控制启动顺序。
- 数据卷持久化 MySQL；初始化脚本挂载到 `/docker-entrypoint-initdb.d`。
- 所有密钥走 `.env`，不入库。

### 4. 配置清单（必须外置）

| 变量                         | 说明         |
| ---------------------------- | ------------ |
| `DB_URL/DB_USER/DB_PASSWORD` | 数据库连接   |
| `AMAP_KEY`                   | 数据源密钥   |
| `JWT_SECRET`                 | 鉴权密钥     |
| `CRAWLER_ENABLED`            | 紧急停采开关 |
| `CRAWLER_QPS`                | 采集限速     |

### 5. CI 流水线

```
lint → unit → build → image → e2e → deploy(手动触发)
```

- 失败即停；产物打 commit sha。
- 部署 job 需要人工确认（避免误发）。

### 6. 发布与回滚

- 灰度（可选）：Nginx 按权重分流两版本。
- 回滚：`docker compose` 改回上一个 sha → `up -d`；数据库变更需向前兼容（先加列后删列）。
- 发布后 15 分钟观察：错误率、P95 延迟、任务成功率。

### 7. 上线检查清单

- [ ] `/healthz` 返回 ok，依赖检查通过
- [ ] 种子数据可用（无外网也能演示）
- [ ] 前端路由刷新不 404
- [ ] 日志可在 `docker compose logs` 看到且含 traceId
- [ ] 备份已执行，恢复步骤演练过
- [ ] 密钥未出现在镜像层或日志中

## 产出物清单（DoD）

- [ ] Dockerfile（多阶段）+ compose 文件
- [ ] `.env.example` + 配置说明
- [ ] CI 配置（构建 + 测试 + 镜像）
- [ ] 部署手册（含回滚与排障）
- [ ] 健康检查与日志方案

## 反模式

| 反模式           | 症状               | 修法                    |
| ---------------- | ------------------ | ----------------------- |
| 密钥打进镜像     | 换环境要重新构建   | 环境变量注入            |
| 无 healthcheck   | 容器起了但服务没起 | 加健康检查 + depends_on |
| latest 标签      | 无法回滚到具体版本 | 用 commit sha           |
| 数据库变更不可逆 | 回滚时表结构冲突   | 向前兼容的迁移策略      |
| 只在一台机器验证 | 换机就挂           | 干净机器演练一次        |
