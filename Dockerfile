FROM node:22-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

EXPOSE 8080
EXPOSE 8081
# The site's static page: no lyrics lookup, so a healthcheck never scrapes.
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8081/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD [ "node", "." ]
