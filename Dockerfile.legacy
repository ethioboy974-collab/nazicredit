FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

COPY . .

ENV HOST=0.0.0.0
ENV PORT=5500

EXPOSE 5500

CMD ["node", "server.js"]
