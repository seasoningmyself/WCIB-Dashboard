FROM node:22-bookworm-slim

ARG WCIB_RELEASE_SHA=unknown
ARG WCIB_DEPLOYED_AT
ENV WCIB_RELEASE_SHA=${WCIB_RELEASE_SHA}
ENV WCIB_DEPLOYED_AT=${WCIB_DEPLOYED_AT}

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
