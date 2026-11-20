# ---------- 构建阶段 ----------
FROM maven:3.9-eclipse-temurin-17 AS build

WORKDIR /app

# 先只拷 pom，利用层缓存（改代码不会重下依赖）
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q -Dmaven.test.skip=true package


# ---------- 运行阶段 ----------
FROM eclipse-temurin:17-jre-alpine

# 时区与字体：日志/日期按东八区，避免乱码
RUN apk add --no-cache tzdata curl \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app && chown -R app:app /app

COPY --from=build /app/target/poi-intel.jar /app/app.jar
RUN chown app:app /app/app.jar

USER app
EXPOSE 8080

# 健康检查走业务接口（含 DB 连通性），比端口探测更能反映真实状态
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/api/v1/health || exit 1

# JVM 容器感知：按容器内存自动算堆，避免被宿主大内存误导
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
