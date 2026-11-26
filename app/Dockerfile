FROM node:22-alpine
ENV NODE_ENV=production TZ=America/Sao_Paulo DATA_DIR=/data
RUN apk add --no-cache tzdata font-dejavu fontconfig
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/saude || exit 1
CMD ["node", "--no-warnings", "src/index.js"]
