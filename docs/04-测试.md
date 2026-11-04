# ④ 测试

> 目标：用**四层测试**守住关键路径——改错了立刻红，改对了放心发。

## 四层测试与工具

| 层       | 工具                     | 覆盖对象                  | 速度 |
| -------- | ------------------------ | ------------------------- | ---- |
| 单元测试 | Vitest                   | store、工具函数、状态流转 | 毫秒 |
| 组件测试 | Vitest + @vue/test-utils | 组件渲染与交互            | 毫秒 |
| 接口测试 | Vitest + MSW             | 请求封装、错误分支        | 毫秒 |
| 端到端   | Playwright               | 真实浏览器关键路径        | 秒级 |

覆盖率用 `@vitest/coverage-v8`，报告输出 `text` / `html` / `lcov` 三种格式。

## 目录约定

```text
src/**/__tests__/*.spec.ts   单元与组件测试（就近放置）
tests/*.spec.ts              跨模块测试（接口、集成）
tests/setup.ts               全局桩（ResizeObserver / matchMedia）
e2e/*.spec.ts                端到端用例
```

## 写测试的三条建议

1. **测行为不测实现**：断言「点了推进变成进行中」，而不是「调用了 advance」。
2. **异常分支优先**：业务码非 0、网络失败、空数据，这三条最容易线上出事。
3. **E2E 只留主干**：登录 → 核心流程 → 关键反馈，控制在 10 条以内。

## 验收清单

- [ ] `pnpm test` 全绿，覆盖率 ≥ 70%（核心 store / lib）
- [ ] `pnpm e2e` 在 Chromium 上全绿
- [ ] 每个 bug 修复都补了一条回归用例

## 常用命令

```bash
pnpm test              # 跑一次单测
pnpm test:watch        # 监听模式
pnpm test:coverage     # 覆盖率报告
pnpm e2e               # Playwright（首次需 pnpm exec playwright install chromium）
```
