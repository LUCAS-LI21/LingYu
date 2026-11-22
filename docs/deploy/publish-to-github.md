# 发布到 GitHub（评委可打开）

> 本地仓库已就绪，但没有配置 remote、也没有 `gh` CLI。
> 下面两条命令由你在有 GitHub 凭据的机器上执行即可（**仓库里没有任何密钥，可安全公开**）。

## 一、创建仓库并推送

1. 在 GitHub 新建仓库（建议 **Public**，不要勾选 README/.gitignore/License，避免冲突），记下地址，例如
   `https://github.com/<你的账号>/poi-intel.git`

2. 在项目根目录执行：

```bash
git remote add origin https://github.com/<你的账号>/poi-intel.git
git branch -M main
git push -u origin main
```

3. 推送后把 README 里两处 `OWNER/REPO` 替换成你的实际路径（CI 徽章、Codespaces 徽章）：

```bash
# 例如
sed -i 's#OWNER/REPO#<你的账号>/poi-intel#g' README.md
git commit -am "docs: 替换仓库路径" && git push
```

## 二、开启 Codespaces（评委"点开就能用"）

1. 仓库 **Settings → General** 无需改动；
2. 仓库首页 → **Code → Codespaces** → 已有 `/.devcontainer/devcontainer.json`，会自动识别；
3. 评委点 README 里的 **Open in GitHub Codespaces** 徽章即可创建；
4. 首次创建会执行：
   - `setup.sh`：生成 `.env`（随机运营口令 / 数据库口令 / AUTH_SECRET）
   - `start.sh`：`docker compose up -d --build`，随后等待就绪
5. 端口 `8081` 会自动打开浏览器预览；`8443`（HTTPS）、`18080`（API）也会转发；
6. 运营口令在 Codespaces 的 `.env` 里（每次创建随机，不写死在仓库）。

> Codespaces 免费额度：个人账号每月约 120 核时 / 15 GB 存储；本项目 4C8G 实例约能跑 30 小时，够初赛评审。
> 若额度紧张，可把 `devcontainer.json` 的 `hostRequirements` 调整为 2C4G（构建会慢一些）。

## 三、CI 会做什么

推送后 `.github/workflows/ci.yml` 自动运行：

| Job       | 内容                                                 |
| --------- | ---------------------------------------------------- |
| `quality` | lint / format / typecheck / 单测（77 例）/ 构建      |
| `e2e`     | 起 MySQL + 后端，跑 Playwright（20 例，桌面 + 移动） |
| `deploy`  | 构建并推送镜像到 GHCR（仅 main 分支）                |

首次运行需要几分钟；徽章变绿即可作为"可运行"的公开证据。

## 四、公开前检查（已确认项）

- [x] `.env` 未入库（`.gitignore` 已忽略，仓库只有 `.env.example` / `.env.deploy.example` 占位模板）
- [x] 无真实 API Key（高德/DeepSeek 均通过环境变量注入，缺省不启用）
- [x] 默认口令已移除；空口令/默认口令会让后端拒绝启动
- [x] 政府数据、OSM、Esri 的署名与许可说明齐全（`LICENSE` + `docs/design/data-source-matrix.md`）
- [x] `target/`、`dist/`、`node_modules/` 等构建产物已忽略
- [ ] **`data/` 仍随仓库分发（18 文件 / 4.7MB，含政府开放数据与 PDF）**：政府数据条款禁止再分发，公开仓库前需评估或改为发布页下载（详见 docs/audit/report-data.md D1）

## 五、如果不想开 Codespaces

仓库根目录自带一键 compose，评委本地装 Docker 后：

```bash
git clone https://github.com/<账号>/poi-intel.git && cd poi-intel
cp .env.deploy.example .env      # 填写四个必填口令
docker compose --env-file .env up -d --build
# http://127.0.0.1:8081
```

## 六、把高德 Key 配到 Codespaces Secrets

Key 不进仓库，用 Codespaces Secrets 注入（容器里会变成同名环境变量，`setup.sh` 自动写进 `.env`）。

1. 仓库页面 → **Settings → Secrets and variables → Codespaces** → **New repository secret**
2. Name：`AMAP_KEY`；Secret：你的高德「Web服务」Key（32 位）
3. （可选）再建 `DEEPSEEK_API_KEY`，用于 Agent 建议；不配则 Agent 区块为空，不影响主流程
4. 让已有 Codespace 生效：**Codespace → Command Palette → Codespaces: Rebuild Container**
   （或删除旧 Codespace 重新创建）
5. 验证：
   ```bash
   grep AMAP_KEY .env            # 应能看到值（文件已被 gitignore）
   curl -s "http://127.0.0.1:18080/api/v1/live/pois?lng=114.0579&lat=22.5431&radius=1000&keywords=ATM" \
     | head -c 200                # 返回 enabled:true 即生效
   ```

> 注意：Codespaces Secrets 只对**你选择授权的仓库**生效；分发给评委的公开仓无需包含 Key，
> 评委没有 Key 时实时层显示「未配置」，其余功能完全可用。
