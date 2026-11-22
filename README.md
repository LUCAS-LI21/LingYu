# LingYu

以小区和银行为基线的智慧数据洞察与服务平台。采集深圳银行网点与住宅小区数据，提供地图查询、列表筛选、周边关联、数据洞察与反馈审核闭环。

## 技术架构

- 前端：Vue 3、TypeScript、Vite、Leaflet、Tailwind CSS
- 后端：Spring Boot 3、MyBatis-Plus、MySQL 8
- 小程序：微信小程序，共用后端 API
- 部署：Docker Compose、GitHub Actions、GitHub Pages

## 运行

```bash
cp .env.deploy.example .env
docker compose --env-file .env up -d --build
```

Web：http://127.0.0.1:8081

## 文档

[docs](docs) · [部署说明](docs/deploy/github-deployment.md)

## License

[MIT](LICENSE)
