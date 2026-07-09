FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

RUN npm run check \
    && npm test \
    && npm run build:client

USER node

EXPOSE 5000

CMD ["npm", "run", "dev:server"]
