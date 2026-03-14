FROM node:22-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

EXPOSE 8080
EXPOSE 8081
CMD [ "node", "." ]
