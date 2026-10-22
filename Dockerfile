# Install production dependencies
FROM node:24-alpine AS dependencies

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev


# Runtime image : multi stage build for remove npm vulnerabilities
FROM node:24-alpine AS runtime

WORKDIR /usr/src/nodejs-app/app


RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY --chown=node:node . .
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

ENV NODE_ENV=production

EXPOSE 8080

USER node

CMD ["node", "app.js"]