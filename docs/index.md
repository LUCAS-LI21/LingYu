# BISAI Agent 工程手册

一个可直接开工的网站工程骨架：六阶段各有对应工具，命令一键跑通。

## 六阶段与工具对照

| 阶段                       | 目标                              | 主力工具                            | 命令                    |
| -------------------------- | --------------------------------- | ----------------------------------- | ----------------------- |
| [① 需求分析](/01-需求分析) | 把口头需求变成可验收的规格        | VitePress、Markdown                 | `pnpm docs:dev`         |
| [② 设计](/02-设计)         | 统一视觉令牌与交互语义            | Tailwind v4、Element Plus、Iconify  | `pnpm dev`              |
| [③ 实现](/03-实现)         | 快速且类型安全地写业务            | Vite、Vue 3、Pinia、ESLint          | `pnpm dev`              |
| [④ 测试](/04-测试)         | 单元 / 组件 / 接口 / E2E 四层覆盖 | Vitest、Test Utils、MSW、Playwright | `pnpm test`、`pnpm e2e` |
| [⑤ 部署](/05-部署)         | 可重复、可回滚地发布              | Docker、Nginx、GitHub Actions       | `docker compose up -d`  |
| [⑥ 业务闭环](/06-业务闭环) | 线上表现可度量、可回归            | Sentry、web-vitals、埋点            | 自动                    |

## 三条主线

- **质量主线**：`pnpm check` = Lint + 格式 + 类型 + 单测，提交前一次过。
- **交付主线**：`pnpm build` → Docker 镜像 → Nginx，任何环境一条命令起。
- **反馈主线**：页面埋点 + Core Web Vitals + 错误上报，回流到需求池。

## 目录约定

```text
src/          业务代码（views / components / stores / lib）
tests/        单元与接口测试
e2e/          Playwright 端到端
docs/         本手册（VitePress）
docker/       Nginx 等部署配置
```
