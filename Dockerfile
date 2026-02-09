FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run typecheck

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json .
COPY apps ./apps
COPY db ./db
COPY static-public ./static-public
COPY tsconfig.json ./tsconfig.json

EXPOSE 3000
CMD ["npm", "run", "ssr"]
