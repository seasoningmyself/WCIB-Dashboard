FROM node:22-bookworm-slim

WORKDIR /app
RUN chown node:node /app

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

RUN npm run check \
    && npm test \
    && npm run build:client

EXPOSE 5000

CMD ["npm", "run", "start"]
