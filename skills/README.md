# Skills 目录

本目录是项目的**工程作业规程库**：每个阶段一个 Skill，供人或 AI 代理按同一套标准干活。

## 目录结构

```
skills/
├── README.md                 # 本文件
├── requirements-analysis/    # ① 需求分析
│   └── SKILL.md
├── system-design/            # ② 设计
├── implementation/           # ③ 实现
├── testing/                  # ④ 测试
├── deployment/               # ⑤ 部署
├── business-loop/            # ⑥ 业务闭环
└── verification/             # 核查（贯穿全程，防幻觉）
```

## SKILL.md 格式（跨厂商标准）

遵循 [Agent Skills Specification](https://agentskills.io/specification)：

| 字段            | 必填 | 约束                                                                           |
| --------------- | ---- | ------------------------------------------------------------------------------ |
| `name`          | 是   | ≤64 字符，仅小写字母/数字/连字符，首尾不能是连字符，**必须与目录名一致**       |
| `description`   | 是   | ≤1024 字符，必须同时说明「做什么」和「何时用」——这是代理判断是否加载的唯一依据 |
| `license`       | 否   | 许可证名或指向 LICENSE 文件                                                    |
| `compatibility` | 否   | ≤500 字符，环境依赖说明                                                        |
| `metadata`      | 否   | string→string 映射                                                             |
| `allowed-tools` | 否   | 空格分隔的预授权工具（实验性）                                                 |

结构约定：`SKILL.md` 必需；`scripts/`（可执行脚本）、`references/`（按需加载的细则）、`assets/`（模板）可选。
**渐进披露**：元数据常驻上下文（约 100 tokens），正文按需加载，因此正文控制在 500 行内，细则拆到 `references/`。

最小示例：

```yaml
---
name: code-review
description: 按团队规范审查变更。当用户提交 PR、要求评审或检查 diff 时使用。
---
```

## 七个技能与使用时机

| 技能                    | 何时触发                           | 核心产出                       |
| ----------------------- | ---------------------------------- | ------------------------------ |
| `requirements-analysis` | 项目启动、需求变更、评审需求完整性 | SRS、用例、数据字典、验收矩阵  |
| `system-design`         | SRS 评审后、引入新组件前           | C4 图、ER、接口契约、ADR       |
| `implementation`        | 开始写功能、拆分提交、Code Review  | 可运行代码、迁移脚本、提交规范 |
| `testing`               | 功能完成、修 bug、演示前回归       | 用例表、四层测试、覆盖率报告   |
| `deployment`            | 首次部署、每次发版、回滚           | 镜像、compose、CI、部署手册    |
| `business-loop`         | 系统上线、要证明"闭环是真的"       | 三条闭环、指标看板、运营 SOP   |
| `verification`          | 任何要下结论的时刻                 | 核查记录、评审意见、未核实清单 |

## 如何"真的用起来"

1. **人工使用**：开工前打开对应 `SKILL.md`，按「步骤」走，用「产出物清单」自查。
2. **代理使用**：把 `skills/` 目录作为工程约定告诉代理（见根目录 `AGENTS.md`），并要求"动手前先读对应 SKILL.md"。
3. **CI 卡口**：把每个 Skill 的 DoD 抄进 PR 模板，未勾选不予合并。

## 外部参考（已核验）

| 资源                                                                 | 说明                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| [agentskills.io/specification](https://agentskills.io/specification) | 跨厂商 Agent Skills 格式标准（2026-11-05 实测 HTTP 200）    |
| [github.com/anthropics/skills](https://github.com/anthropics/skills) | 官方技能示例集（含 `skill-creator`、`webapp-testing`）      |
| [github.com/obra/superpowers](https://github.com/obra/superpowers)   | 方法论型技能： brainstorming → plan → TDD → review → finish |
| [github.com/wshobson/agents](https://github.com/wshobson/agents)     | 大规模技能/代理集合（MIT）                                  |

> 上述仓库均由子代理检索并经主代理二次打开页面核验；star 数等动态数据未记录，避免过期误导。

## 写给未来的自己

- 这套 Skill 是**约束**，不是文档：每条铁律都来自踩过的坑。
- 第 7 个 `verification` 比前六个更重要——它决定了前六个是不是在自欺欺人。
