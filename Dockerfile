FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_SUI402_CONSOLE_API_URL=http://localhost:4030
ENV VITE_SUI402_CONSOLE_API_URL=$VITE_SUI402_CONSOLE_API_URL

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY move ./move
COPY docs ./docs
COPY scripts ./scripts

RUN npm ci
RUN npm run build

FROM node:22-alpine AS provider-api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/provider-api ./apps/provider-api
EXPOSE 4020
CMD ["node", "apps/provider-api/dist/server.js"]

FROM node:22-alpine AS console-api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/console-api ./apps/console-api
EXPOSE 4030
CMD ["node", "apps/console-api/dist/server.js"]

FROM node:22-alpine AS indexer
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
CMD ["node", "packages/indexer/dist/sync.js", "sync", "--loop", "true", "--setup", "true"]

FROM nginx:1.27-alpine AS dashboard
COPY deploy/nginx/dashboard.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
