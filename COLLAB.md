# 双会话协作契约（后端 / 前端）

> 本文件是**两个开发会话之间唯一的协调依据**。
> 每个会话开工前必读：本文件 → AGENTS.md → MEMORY.md → docs/api/openapi.yaml。

## 1. 角色与目录所有权

| 会话                   | 负责目录                                                                        | 不碰                           |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------ |
| **后端会话**（本会话） | `backend/`、`docs/`、`scripts/`（后端脚本）、`docker-compose.yml`、`Dockerfile` | `src/`、`tests/`、`e2e/`       |
| **前端会话**           | `src/`、`tests/`、`e2e/`、`index.html`、`tailwind`/`vite` 配置                  | `backend/`、`docs/`、`docker/` |

**跨越边界的改动**必须在 `## 6. 交接区` 写一条，双方确认后再动。

## 2. 共享契约文件：单一所有者

这几个文件两侧都会用到，**只允许后端会话修改**，前端会话只读、按契约实现：

| 文件                                                     | 为什么单属                  |
| -------------------------------------------------------- | --------------------------- |
| `docs/api/openapi.yaml`                                  | 接口契约的唯一定义          |
| `src/types/poi.ts`                                       | 前端类型必须与后端 DTO 对齐 |
| `src/api/server.ts` / `admin.ts` / `auth.ts` / `live.ts` | 请求封装、错误码、鉴权头    |

前端若要加字段：**先在交接区提需求**，后端改契约 + DTO，前端再跟。

## 3. Git 工作流

物理隔离用 **git worktree**，两个目录共享同一个 `.git`，但各占一个分支：

```text
E:\TraeMaven\BISAI-AGENT       main            后端会话
E:\TraeMaven\BISAI-FRONTEND    feat/frontend-ui 前端会话
```

规则（吃过亏的）：

1. **禁止 `git add -A` / `git add .`** —— 本仓库已发生过子代理越权写文件被 `-A` 卷进提交的事故。只 add 自己负责的路径。
2. 提交粒度：一个功能一次提交，Conventional Commits，带需求编号（如 `feat(FR-Q-07): ...`）。
3. **不要 rebase 别人的分支**；需要最新后端契约时 `git merge main`。
4. 合并方向：`feat/frontend-ui` → `main`，由前端会话发合并请求，后端会话审查契约部分。

## 4. 端口与进程

| 用途                          | 端口       | 谁启动                                         |
| ----------------------------- | ---------- | ---------------------------------------------- |
| 后端 API                      | `8080`     | **只有后端会话**启动（前端复用，不要起第二个） |
| 前端开发（后端会话目录）      | `5173`     | 后端会话按需                                   |
| 前端开发（前端会话 worktree） | **`5174`** | 前端会话固定用这个                             |

```bash
pnpm dev --port 5174        # 前端会话
```

两边各自 `pnpm install` 一次即可（pnpm store 共享，很快）；**不要同时跑 `pnpm build`**，
构建产物在各自目录里，互不影响，但会同时吃 CPU。

## 5. 数据与数据库

- 数据库只有一份 `poi_intel`，两个会话共用一个后端实例，**不要各自起后端连同一个库**。
- 前端调试需要"接口挂了"的场景：用现有的 mock 回退（`isServerMode()`），不要改后端数据。
- 任何人造测试数据必须可识别（`source='测试…'`）并在结束前删除。

## 6. 交接区（两个会话都往这里写）

格式固定，最新的写在最上面：

```markdown
### 2026-11-10 后端 → 前端

- 契约变更：新增 GET /api/v1/live/pois（L2 实时周边，不落库）
- 前端需要做：详情页加「实时周边」区块，未配置 Key 时显示不可用
- 状态：后端已就绪，等待前端接入
```

```markdown
### YYYY-MM-DD 前端 → 后端

- 需要字段：Poi 增加 `dataUpdatedAt`（列表展示"数据更新时间"）
- 阻塞：无 / 阻塞在 xxx 接口
```

---

### 2026-11-12 后端 → 前端（高德 L2：坐标修正 + 配额闸门）

- 已修后端缺陷（ADR-0002 §6/§7，`mvn test` 8/8 通过）：
  - **坐标**：`/live/address` 入参按 WGS-84 解释，服务端转 GCJ-02 再请求高德；`/live/pois` 返回坐标已转回 WGS-84（`coord_sys=wgs84`），可直接画在 OSM 上，前端不用再转
  - **配额闸门**：每日总预算 300、周边 100、最小间隔 200ms；被拦时 HTTP 仍 200，返回 `{enabled:true, throttled:true, error:"…"}`，**不请求高德**
- 前端需要做（都在 `src/components/DetailPanel.vue`，后端不改）：
  1. 展示 `error` 即可（现有逻辑已支持），无需为 `throttled` 单独写分支
  2. 同一 `poi.id` 会话内只查一次（去重），关掉再开不要重复请求
  3. **禁止**在 `watch(poi)` / `onMounted` / 地图 `moveend` 里调用；保持"点按钮才查"
  4. 按钮 loading 期间禁用（已有），避免连点触发最小间隔提示
- 契约：`src/api/live.ts` 已加可选字段 `throttled?: boolean` / `coord_sys?: string`（后端维护，无需前端改）
- 状态：后端已上线（8080 新构建），前端接入即可

---

### 2026-11-10 前端 → 后端（注册登录 / 账号管理）

- 需求：用户手机号/邮箱 + 密码注册登录；登录后修改密码；管理员设置初始账号密码，并管理新增的运营 Agent 账号（子账号）。
- 现状：后端只有 `POST /api/v1/auth/login`（username/password），`sys_user` 无 phone/email，也没有注册/改密/账号管理接口。前端暂不动 `src/api/auth.ts`，等契约确认后再接。
- 建议契约（可调整）：
  - `POST /api/v1/auth/register` `{account, password, displayName?}`：account 为手机号或邮箱；role=user；返回 `{token, user}`。
  - `POST /api/v1/auth/login` `{account, password}`：account 兼容 username/手机号/邮箱；返回 `{token, username, displayName, role, account, expiresAt}`。
  - `POST /api/v1/auth/change-password`（Bearer）`{oldPassword, newPassword}`。
  - `GET /api/v1/auth/me`（Bearer）：返回当前账号。
  - `GET /api/v1/admin/users?role=&status=&page=&size=`（Bearer）：账号列表。
  - `POST /api/v1/admin/users`（Bearer）`{username, phone?, email?, displayName, password, role: agent|operator}`：管理员设置初始账号密码。
  - `PATCH /api/v1/admin/users/{id}`（Bearer）`{status?, displayName?}`：启停/改名。
  - `POST /api/v1/admin/users/{id}/reset-password`（Bearer）`{password}`：管理员重置密码。
- 数据库：`sys_user` 增加 `phone`/`email`（唯一索引，允许 null）、`password_updated_at`；role 扩展 `user`，保留 `operator`，新增 `agent`（运营子账号）。
- 兼容性：现有 operator 登录与 `/admin/**` 鉴权不能破坏；`src/api/auth.ts`、`docs/api/openapi.yaml` 由后端更新，前端再跟。
- 状态：**阻塞**在以上接口；前端本轮先完成「Agent 建议」Tab（数据接入 Agent），认证页面待接口就绪后开发。

---

### 2026-11-10 后端 → 前端（当前待办）

**新增：字段级来源 + 周边配套（后端已就绪）**

| 能力     | 接口                             | 说明                                                                           |
| -------- | -------------------------------- | ------------------------------------------------------------------------------ |
| 字段来源 | `GET /api/v1/pois/{id}/sources`  | 返回 `[{field, source, source_url, updated_at}]`，回答"这条地址哪来的"         |
| 周边配套 | `GET /api/v1/pois/{id}` 新增字段 | `surroundBankCount` / `surroundAtmCount` / `nearbyBrandCount` / `nearestBankM` |
| 物业公司 | 同上                             | `propertyCompany`（687 个小区有值，其余为空字符串）                            |

**前端建议**：

1. 详情页加「数据来源」小节：把 sources 渲染成"地址 ← 深圳市政府数据开放平台"这种列表，有 `source_url` 的可点击
2. 小区详情把周边配套做成四个小指标卡（1km 银行 / ATM / 品牌数 / 最近距离）
3. `propertyCompany` 为空时整行隐藏，别显示"暂无"

**已就绪、前端可直接用**：

1. `GET /api/v1/live/address?lng=&lat=` —— L2 实时地址，`no-store`，未配 `AMAP_KEY` 时返回
   `{enabled:false, reason:"..."}`，前端要能优雅展示这个 reason
2. `GET /api/v1/live/pois?lng=&lat=&radius=` —— L2 实时周边，返回 `{enabled, items[], stored:false}`
3. `POST /api/v1/admin/import` —— 政府数据导入（前端暂不需要接）
4. `POST /api/v1/admin/pois/{id}/reopen` —— 关闭恢复（后台可以加个入口）

**前端侧待优化（后端无依赖）**：

- 「地址待补充」文案与「查实时地址 / 补充地址」两个入口的视觉权重
- 详情页新增的「实时周边（高德）」区块样式
- 运营后台：反馈列表分页、任务状态自动刷新

**约束**：`src/types/poi.ts` 与 `src/api/*.ts` 属共享契约，改动前先在交接区跟后端对一下。

---

### 2026-11-10 后端 → 前端（Agent 建议 Tab）

**背景**：新增「数据接入 Agent」，能从全网搜索+抽取字段，产出**建议**（不写库），管理员点采纳才生效。

**接口（都已就绪，需 Bearer）**：

| 方法 | 路径                                                                      | 说明                                                                                        |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET  | `/api/v1/admin/agent/status`                                              | `{enabled, model, baseUrl}`，未配 Key 时 enabled=false                                      |
| GET  | `/api/v1/admin/agent/runs?limit=20`                                       | 运行记录：`id, entity_type, entity_id, field, status, result_json, reviewed_by, created_at` |
| POST | `/api/v1/admin/agent/propose?entityType=bank&entityId={id}&field=address` | 触发一次补全，返回 `status + proposal + steps`                                              |
| POST | `/api/v1/admin/agent/{runId}/apply`                                       | 采纳并写库（写版本，operator=`agent:审核人@来源域名`）                                      |

**status 取值**：`ready`（可采纳）/ `needs_review`（有问题，见 `proposal.problems`）/ `rejected`（没抽到）/ `failed` / `applied`（已采纳）。

**前端要做的**：

1. 运营后台新增 Tab「Agent 建议」：列表展示 runs，`ready` 的给「采纳」按钮
2. `result_json` 是字符串，需要 `JSON.parse`；里面 `{value, evidence, sourceUrl, confidence, problems}`
3. 详情里同时展示 `evidence` 与 `sourceUrl`（可点击），让审核人能看到依据
4. 采纳成功后刷新列表

**注意**：`propose` 一次要 5–15 秒（真实搜索+两次 LLM 调用），按钮要有 loading 态，别让人以为卡死。
