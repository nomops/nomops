# nomops 安装版镜像：单容器含 server（API+触发器）+ 前端静态资源。
# 构建上下文 = 仓库根：docker build -f docker/Dockerfile .
#
# ★双形态边界（docs/01）：本仓库 = 实例产品（自托管形态；Cloud 租户跑的也是本镜像）。
# Cloud 编排层（控制平面/运营台）在独立仓库 nomops-cloud——与本镜像零代码耦合。

FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /app
# 先拷清单利用层缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# 显式按实例形态构建（server + frontend 及其依赖 core/db/nodes/workflow）
RUN pnpm exec turbo run build --filter=@nomops/server... --filter=@nomops/frontend...
# 原地裁掉 devDependencies（保留已构建的 dist）
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
ENV NOMOPS_STATIC_DIR=/app/packages/frontend/dist
ENV PORT=5678
EXPOSE 5678
# SQLite 默认落 /data（挂卷持久化）；用 DB_TYPE=postgres 时无用
ENV DB_SQLITE_FILE=/data/nomops.db
RUN mkdir -p /data
VOLUME /data
# 健康检查：打 /healthz（node22 自带 fetch，无需 curl）。start-period 覆盖首启迁移。
# 注意：worker 无 HTTP 端口，compose 里已对 worker 显式禁用此继承来的检查。
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT||5678}/healthz`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "packages/server/dist/main.js"]
