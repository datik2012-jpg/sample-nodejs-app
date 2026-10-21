FROM node:24-alpine

WORKDIR /usr/src/nodejs-app/app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

USER node

CMD ["node", "app.js"]
