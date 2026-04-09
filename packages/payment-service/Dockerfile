FROM node:22.12.0-alpine
RUN npm install -g pnpm@9.14.4
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json ./
COPY packages/payment-service/package.json ./packages/payment-service/
COPY packages/message-broker/package.json ./packages/message-broker/

RUN pnpm install --frozen-lockfile

COPY packages/message-broker/tsconfig.json ./packages/message-broker/
COPY packages/message-broker/src ./packages/message-broker/src
COPY packages/payment-service/src ./packages/payment-service/src
COPY packages/payment-service/tsconfig.json ./packages/payment-service/

RUN pnpm --filter @bugspotter/message-broker build
RUN pnpm --filter @bugspotter/payment-service build

EXPOSE 3002
CMD ["node", "packages/payment-service/dist/index.js"]
