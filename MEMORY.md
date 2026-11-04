# MEMORY.md — 项目状态快照

> 每次会话结束前更新；新会话开始先读这里，避免上下文丢失。
> 最后更新：2026-11-05

## 当前阶段

**M0 需求分析 —— 进行中**

已完成：
- 子代理调研：Agent Skill 标准格式（已核验 agentskills.io）、软件工程六阶段方法论
- 需求规格：`docs/requirements/01-SRS.md`（含 6 条用例、41 条 FR、12 条 NFR、3 条闭环链路）
- 数据字典草案：`docs/requirements/02-数据字典.md`
- 合规说明：`docs/requirements/03-合规与数据来源.md`
- Skill 体系：`skills/`（7 个技能 + 索引）
- Git 仓库初始化，首提交 `b1bc5d5`

进行中：
- 子代理 A：GitHub 同类开源项目调研（待回收 → 核验 → 写入 `docs/research/`）

## 待决问题（阻塞设计阶段）

| 编号 | 问题 | 建议 | 状态 |
| --- | --- | --- | --- |
| Q1 | 后端栈 | Spring Boot 3 + Java 17 + MyBatis-Plus | 待确认 |
| Q2 | 数据库 | MySQL 8（本机已有，免 Docker） | 待确认 |
| Q3 | 地图方案 | Leaflet + 开源瓦片（免 Key），高德 JS 作增强 | 待确认 |
| Q4 | 数据来源 | 高德 API + 种子数据双轨 | 待确认 |
| Q5 | 目标城市 | 杭州 | 待确认 |
| Q6 | 用户体系 | 仅内置账号，不开放注册 | 待确认 |
| Q7 | 演示环境 | 本机 / 服务器 | 待确认 |

## 环境事实（已核实）

- 工作区：`E:\TraeMaven\BISAI-AGENT`（Windows）
- Node 24.11 / pnpm 11.9 / Java 17.0.12 / Maven 3.9.12
- MySQL 8.0 服务运行中：`MySQL80`（D:\MySQL\MySQL Server 8.0）
- Docker Desktop **未运行**（`docker info` 连不上命名管道）
- 网络：npm 走 npmmirror 镜像 + 本地代理 127.0.0.1:7892
- 前端骨架已存在并通过 `pnpm check`（14 单测 + 6 E2E）

## 下一步（M1 设计）

1. 回收并核验 OSS 调研结论 → `docs/research/oss-survey.md`
2. 用户拍板 Q1-Q7
3. 出 C4 容器图 + ER 图 + OpenAPI 契约 + 5 条 ADR
4. 设计评审（派子代理挑刺）

## 工作习惯备忘

- 关键结论必有证据；不确定就写「未核实」
- 每完成一个可交付物立即 `git commit`
- 复杂调研派子代理，主代理负责核验与裁决
