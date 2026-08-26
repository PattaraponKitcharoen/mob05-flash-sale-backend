# Stage 1: Build Environment
FROM node:18-alpine AS builder
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production Environment
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY --from=builder /usr/src/app/dist ./dist
CMD ["node", "dist/main.js"]