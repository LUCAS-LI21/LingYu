# BISAI Agent · 网站开发全流程工程骨架

一套「需求分析 → 设计 → 实现 → 测试 → 部署 → 业务闭环」都能跑通的前端工程。
开箱即用，装的全是各环节使用量最大、维护最活跃的插件。

## 快速开始

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173
```

首次拉代码后想一次性体检：

```bash
pnpm check        # Lint + 格式 + 类型 + 单测
pnpm build        # 生产构建
```

## 六阶段 × 工具链

| 阶段       | 主力工具                                                                            | 解决什么问题                                    |
| ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| ① 需求分析 | **VitePress**                                                                       | PRD、验收标准、流程说明统一放文档站，可内网部署 |
| ② 设计     | **Tailwind CSS v4**、**Element Plus**、**Iconify**                                  | 设计令牌 + 组件库 + 图标按需引入                |
| ③ 实现     | **Vite 8**、**Vue 3.5**、**Pinia 4**、**Vue Router 5**、**ESLint 10**、**Prettier** | 秒级热更新、TS 全链路类型、规范自动兜底         |
| ④ 测试     | **Vitest 5**、**@vue/test-utils**、**MSW**、**Playwright**                          | 单元/组件/接口/端到端四层覆盖                   |
| ⑤ 部署     | **Docker**、**Nginx**、**GitHub Actions**                                           | 多阶段镜像、SPA 回退、CI/CD 一条龙              |
| ⑥ 业务闭环 | **Sentry**、**web-vitals**、自定义埋点                                              | 错误可定位、性能可度量、行为可分析              |

辅助插件：`unplugin-auto-import`、`unplugin-vue-components`、`unplugin-icons`、`vite-plugin-vue-devtools`、`rollup-plugin-visualizer`。

## 目录结构

```text
.
├─ src/
│  ├─ views/          页面（Home / Board / 404）
│  ├─ components/     可复用组件
│  ├─ stores/         Pinia 状态
│  ├─ lib/            http 封装、埋点与监控
│  ├─ router/         路由与页面级埋点
│  └─ assets/         样式与 Tailwind 令牌
├─ tests/             单元 / 接口测试 + 全局桩
├─ e2e/               Playwright 用例
├─ docs/              VitePress 工程手册
├─ docker/            Nginx 配置
├─ Dockerfile         多阶段构建
├─ docker-compose.yml 一键起服务
└─ .github/workflows/ CI + 镜像发布
```

## 常用命令

| 命令                               | 说明                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                         | 开发（`/api` 代理到 `:8080`）                              |
| `pnpm build`                       | 类型检查 + 生产构建（生成 hidden sourcemap）               |
| `pnpm build:analyze`               | 输出 `stats.html` 包体积分析                               |
| `pnpm check`                       | 质量四件套                                                 |
| `pnpm test` / `pnpm test:coverage` | 单测 / 覆盖率                                              |
| `pnpm e2e`                         | Playwright（首次 `pnpm exec playwright install chromium`） |
| `pnpm docs:dev`                    | 文档站                                                     |
| `docker compose up -d --build`     | 构建镜像并起服务（`:8081`）                                |

## 环境变量

复制 `.env.example` → `.env.local`：

| 变量                      | 作用                                       |
| ------------------------- | ------------------------------------------ |
| `VITE_API_BASE_URL`       | 接口前缀，默认 `/api`                      |
| `VITE_API_PROXY`          | 开发代理目标，默认 `http://127.0.0.1:8080` |
| `VITE_SENTRY_DSN`         | 留空 = 关闭错误上报（本地/CI 无噪音）      |
| `VITE_ANALYTICS_ENDPOINT` | 埋点上报地址，留空只打控制台               |

## 两个环境相关的坑（已在仓库内修好）

1. **pnpm 在 Windows 上的 junction 问题** —— `pnpm-workspace.yaml` 固定 `nodeLinker: hoisted`，并且 `allowBuilds.esbuild: false`（沙箱环境下 postinstall 会 EPERM，跳过不影响功能）。
2. **Tailwind v4 的原生二进制** —— 走 `postcss.config.js` 接入，不参与 Vite 配置打包，避免加载全平台 `.node` 失败。

## 下一步建议

- 需要后端联调：把 `.env.local` 的 `VITE_API_PROXY` 指向你的 Spring Boot 服务。
- 需要真实监控：填 `VITE_SENTRY_DSN`，并在 `pnpm build` 后上传 sourcemap。
- 需要灰度：在 Nginx 里加 `split_clients`，按比例分流到两个镜像 tag。
