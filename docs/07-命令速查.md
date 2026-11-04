# 命令速查

## 日常开发

| 命令                 | 说明                                         |
| -------------------- | -------------------------------------------- |
| `pnpm dev`           | 启动开发服务器（`:5173`，`/api` 代理到后端） |
| `pnpm docs:dev`      | 启动文档站                                   |
| `pnpm build`         | 类型检查 + 生产构建，产物在 `dist/`          |
| `pnpm preview`       | 预览构建产物（`:4173`）                      |
| `pnpm build:analyze` | 构建并生成 `stats.html` 包体积报告           |

## 质量

| 命令                | 说明                          |
| ------------------- | ----------------------------- |
| `pnpm lint`         | ESLint 检查并自动修复         |
| `pnpm lint:check`   | 只检查不修复（CI 用）         |
| `pnpm format`       | Prettier 全量格式化           |
| `pnpm format:check` | 只检查格式（CI 用）           |
| `pnpm typecheck`    | vue-tsc 类型检查              |
| `pnpm check`        | 上述全部 + 单测，提交前跑一遍 |

## 测试

| 命令                                    | 说明                                |
| --------------------------------------- | ----------------------------------- |
| `pnpm test`                             | 单测 / 组件测试 / 接口测试          |
| `pnpm test:watch`                       | 监听模式                            |
| `pnpm test:coverage`                    | 覆盖率报告（`coverage/index.html`） |
| `pnpm e2e`                              | Playwright 端到端                   |
| `pnpm exec playwright install chromium` | 首次安装浏览器                      |

## 部署

| 命令                                     | 说明                       |
| ---------------------------------------- | -------------------------- |
| `docker compose up -d --build`           | 构建并启动（前端 `:8081`） |
| `docker compose --profile backend up -d` | 同时启动后端占位服务       |
| `docker compose logs -f web`             | 跟踪日志                   |
| `docker compose down`                    | 停止并清理                 |

## 环境变量

复制 `.env.example` 为 `.env.local`：

| 变量                      | 说明                                       |
| ------------------------- | ------------------------------------------ |
| `VITE_API_BASE_URL`       | 接口前缀，默认 `/api`                      |
| `VITE_API_PROXY`          | 开发代理目标，默认 `http://127.0.0.1:8080` |
| `VITE_SENTRY_DSN`         | 留空则关闭错误上报                         |
| `VITE_ANALYTICS_ENDPOINT` | 埋点上报地址，留空则只打控制台             |

## 常见问题

**pnpm 装在 Windows 上符号链接报错？**
本仓库在 `pnpm-workspace.yaml` 里固定了 `nodeLinker: hoisted`（扁平布局），避免 junction 解析问题。

**构建时 Tailwind 原生模块报错？**
Tailwind v4 通过 `postcss.config.js` 接入，不参与 Vite 配置打包，规避原生二进制加载问题。
