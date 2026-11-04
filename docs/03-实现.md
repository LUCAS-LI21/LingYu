# ③ 实现

> 目标：用最少的样板代码写出**类型安全**的业务，并且改一行就热更新。

## 用到的工具

| 工具                    | 作用             | 为什么选它                             |
| ----------------------- | ---------------- | -------------------------------------- |
| Vite                    | 开发服务器与构建 | 冷启动 <1s，HMR 毫秒级，生态最大       |
| Vue 3 + TypeScript      | 视图与类型       | 组合式 API 好复用，类型贯穿模板        |
| Vue Router 5            | 路由与懒加载     | 官方方案，天然代码分割                 |
| Pinia                   | 状态管理         | Vue 官方推荐，TS 推导最友好            |
| unplugin-auto-import    | 自动导入 API     | 减少 `import { ref }` 这类噪音         |
| unplugin-vue-components | 组件按需注册     | Element Plus 用到才打包                |
| ESLint + Prettier       | 规范与格式       | 前者查逻辑问题，后者只管排版，互不打架 |
| Vue DevTools            | 调试面板         | 组件树、Pinia 状态、路由一览           |

## 关键约定

- 路径别名 `@/` 指向 `src/`，禁止 `../../../`。
- 请求统一走 `src/lib/http.ts`：自动带 token、统一解包 `{code,message,data}`、异常自动埋点。
- 页面放 `src/views`，可复用组件放 `src/components`，纯函数放 `src/lib`。
- 组件命名多单词（`PhaseCard`），页面组件用 `*View.vue`。

## 自动导入说明

`ref` / `computed` / `useRoute` 等无需手写 import；Element Plus 组件同理。
类型声明由插件自动生成到 `src/auto-imports.d.ts` 与 `src/components.d.ts`（已入库，保证 CI 类型检查通过）。

## 验收清单

- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm lint` 零 error，`pnpm format:check` 通过
- [ ] 新增页面已配路由与懒加载
- [ ] 接口调用有 loading / error / empty 三态

## 常用命令

```bash
pnpm dev          # 开发（含后端代理 /api -> :8080）
pnpm typecheck    # 仅类型检查
pnpm lint         # 自动修复可修复项
pnpm build        # 类型检查 + 生产构建
```
