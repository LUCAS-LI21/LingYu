# ---------- 构建阶段 ----------
FROM node:24-alpine AS build

WORKDIR /app

# 镜像内用国内源，构建更快；如需改用官方源可覆盖
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
RUN corepack enable

# 先装依赖，利用层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build


# ---------- 运行阶段 ----------
FROM nginx:1.27-alpine AS runner

# 自签证书：内网/演示环境开箱即用 HTTPS；正式上线把这两个文件换成 CA 签发的即可
RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/certs \
    && openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
       -keyout /etc/nginx/certs/server.key \
       -out /etc/nginx/certs/server.crt \
       -subj "/C=CN/ST=Guangdong/L=Shenzhen/O=poi-intel/CN=poi-intel.local" \
       -addext "subjectAltName=DNS:localhost,DNS:poi-intel.local,IP:127.0.0.1"

RUN rm -rf /usr/share/nginx/html/*
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- --no-check-certificate https://127.0.0.1/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
