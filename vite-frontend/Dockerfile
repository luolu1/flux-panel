# 多阶段构建 - 构建阶段
FROM node:20.19.0 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

# vite.config.ts 关闭了 minify 与 treeshake，产物约 7.5MB，构建期 rollup 峰值内存
# 超过 Node 默认堆上限（约 512MB～1.5GB，取决于机器内存），会导致 OOM 构建失败。
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# 生产阶段
FROM nginx:stable-alpine AS production-stage

COPY nginx.conf /etc/nginx/nginx.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
