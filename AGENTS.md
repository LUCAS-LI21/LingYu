# AGENTS.md — 项目协作约定与记忆索引

> 任何代理（人或 AI）接手本项目，**先读本文件，再读对应的 Skill**。
>
> **双会话开发**：本项目分为「后端会话」与「前端会话」两条并行工作线，
> 目录所有权、共享契约、Git 工作流与交接格式见 [COLLAB.md](COLLAB.md)。开工前必读。

## 1. 项目是什么

**邻域 POI 情报系统**（代号 `poi-intel`）：采集银行网点与小区 POI，提供地图 / 列表 / 关联查询，并通过用户反馈与查询热点驱动数据持续更新，形成完整业务闭环。

- **需求基准（最高优先级）**：[docs/requirements/00-赛题原文.md](docs/requirements/00-赛题原文.md)
  —— 赛题原文 + 实现状态对照表。**任何功能取舍、优先级排序、答辩陈述，先对照它。**
- 详细需求：[docs/requirements/01-SRS.md](docs/requirements/01-SRS.md)
- 当前阶段：见 [MEMORY.md](MEMORY.md)

## 2. 六阶段与对应 Skill

| 阶段       | 开工前必读                                                                     | 主要产出                |
| ---------- | ------------------------------------------------------------------------------ | ----------------------- |
| ① 需求分析 | [skills/requirements-analysis/SKILL.md](skills/requirements-analysis/SKILL.md) | SRS、数据字典、验收矩阵 |
| ② 设计     | [skills/system-design/SKILL.md](skills/system-design/SKILL.md)                 | C4、ER、接口契约、ADR   |
| ③ 实现     | [skills/implementation/SKILL.md](skills/implementation/SKILL.md)               | 代码、迁移脚本          |
| ④ 测试     | [skills/testing/SKILL.md](skills/testing/SKILL.md)                             | 用例、四层测试          |
| ⑤ 部署     | [skills/deployment/SKILL.md](skills/deployment/SKILL.md)                       | 镜像、compose、CI       |
| ⑥ 业务闭环 | [skills/business-loop/SKILL.md](skills/business-loop/SKILL.md)                 | 三条闭环、看板、SOP     |

贯穿全程：[skills/verification/SKILL.md](skills/verification/SKILL.md) —— **下任何结论前先过一遍**。

## 3. 硬性规则

1. **需求编号是通用语言**：提交信息、测试用例、设计文档都写 `FR-Q-07` 这样的编号。
2. **无证据不下结论**：事实要能打开链接，结果要能贴命令与退出码，否则标「未核实」。
3. **子代理交叉审查**：重要产出（选型、架构、SRS）派一个"挑刺者"子代理找漏洞，主代理逐条回应后再定稿。
4. **小步提交**：一次提交一件事，Conventional Commits，`feat(FR-Q-07): ...`。
5. **决策留痕**：技术选择写 `docs/adr/NNNN-*.md`；阶段状态写 `MEMORY.md`。
6. **合规优先**：任何采集实现先过 [docs/requirements/03-合规与数据来源.md](docs/requirements/03-合规与数据来源.md) 的检查清单。

## 4. 目录约定

```
src/            前端（Vue3 + TS + Element Plus + Tailwind）
tests/ e2e/     前端测试
docs/requirements/  需求阶段产物
docs/adr/           架构决策记录
docs/research/      调研与核查记录
skills/             工程作业规程
docs/               VitePress 文档站
```

未来后端将落在 `backend/`（Spring Boot），数据库脚本 `db/migration/`。

## 5. 常用命令

```bash
pnpm dev / pnpm build / pnpm check / pnpm e2e    # 前端
pnpm docs:dev                                    # 文档站
git log --oneline                                # 查看历史
```

## 6. 明确禁止

- 编造仓库名、URL、版本号、star 数；把"文档没写"当成"不支持"。
- 未做 robots/白名单校验就写采集实现。
- 未经说明就大范围重构（>3 个文件的结构性改动先出方案）。
- 把密钥、内网地址写进代码或提交历史。

## 7. 环境已知坑（踩过了，别再踩）

| 坑                    | 现象                                                         | 处理                                             |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| pnpm 隔离布局         | Windows 上 symlink 栈溢出、vite 解析不到 transitive 依赖     | `pnpm-workspace.yaml` 固定 `nodeLinker: hoisted` |
| esbuild postinstall   | 本机沙箱 spawn EPERM                                         | `allowBuilds.esbuild: false`，二进制由平台包提供 |
| Tailwind v4 原生模块  | 打包 vite.config 时读全平台 `.node` 失败                     | 走 `postcss.config.js` 接入                      |
| Element Plus 样式层级 | 压住 Tailwind 工具类（输入框被挤扁）                         | `@import '...' layer(base)`                      |
| TypeScript 7          | vue-tsc 不兼容 `./lib/tsc` 导出                              | 锁 TS 5.9.x                                      |
| Docker                | Desktop 未启动                                               | 部署阶段先确认；提供非容器兜底                   |
| VitePress 构建崩溃    | 已有 `docs/.vitepress/dist` 时 `0xC0000409` 栈溢出，3/3 复现 | `docs:build` 已内置 `docs:clean` 前置清空        |
