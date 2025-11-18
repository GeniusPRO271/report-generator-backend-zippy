 FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

COPY . .

EXPOSE 3110

CMD ["sh", "-c", "bun run dev:api & bun run dev:worker && wait"]

