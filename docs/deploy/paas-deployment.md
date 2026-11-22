# PaaS 部署步骤（Render + TiDB Cloud）

目标：获得公网 HTTPS API，供网站与微信小程序使用。
费用：0 元（Render 免费实例 + TiDB Cloud Serverless 免费额度）。

## 1. 创建 MySQL 数据库（TiDB Cloud）

1. 打开 https://tidbcloud.com，用 GitHub 或邮箱注册。
2. **Create Cluster → Serverless**，Region 选 `Singapore`，创建。
3. 等待 1–2 分钟，进入集群 → **Connect**，记录：
   - `Host`：如 `gateway01.ap-southeast-1.prod.aws.tidbcloud.com`
   - `Port`：`4000`
   - `User`：如 `3xxxxxx.root`
   - `Password`：点 **Generate Password** 生成并保存
   - `Database`：`test`
4. （可选）在 **SQL Editor** 执行 `CREATE DATABASE poi_intel;`，后面 `DB_NAME` 填 `poi_intel`；不建则填 `test`。

## 2. 部署后端（Render）

1. 打开 https://render.com，用 GitHub 登录并授权访问仓库。
2. 控制台 **New + → Blueprint**，选择 `LUCAS-LI21/LingYu`，点击 **Apply**。
3. 按页面提示填写环境变量：

   | 变量                | 填写                     |
   | ------------------- | ------------------------ |
   | `DB_HOST`           | TiDB 的 Host             |
   | `DB_PORT`           | `4000`                   |
   | `DB_NAME`           | `poi_intel` 或 `test`    |
   | `DB_USER`           | TiDB 的 User             |
   | `DB_PASSWORD`       | TiDB 的 Password         |
   | `OPERATOR_PASSWORD` | 自定义后台口令（强口令） |
   | `AMAP_KEY`          | 可留空                   |
   | `DEEPSEEK_API_KEY`  | 可留空                   |

   `AUTH_SECRET` 由 Render 自动生成，`DB_SSL_MODE=REQUIRED` 已写在配置里。

4. 点击 **Deploy**，等待 5–10 分钟。
5. 打开 `https://lingyu-api.onrender.com/api/v1/health`，返回 HTTP 200 即成功。
   首次访问可能休眠约 30 秒。

## 3. 验证接口

```bash
curl https://lingyu-api.onrender.com/api/v1/health
curl "https://lingyu-api.onrender.com/api/v1/pois?size=1"
```

## 4. 小程序连接

1. 修改 `miniprogram/config.js`：

   ```js
   const API_BASE = 'https://lingyu-api.onrender.com'
   ```

2. 微信公众平台 → 开发管理 → 开发设置 → **服务器域名 → request 合法域名**，添加该域名。
3. 微信开发者工具中重新编译、上传体验版，真机即可使用。

## 注意事项

- Render 免费实例无请求会休眠，评审前先访问一次唤醒。
- TiDB Serverless 免费额度足够本项目的读写量。
- 后台口令必须自定义，不要使用示例值。
- 数据库表由后端启动时自动迁移，无需手动建表。
