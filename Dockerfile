# For hosts that run containers (Fly.io, Railway, Google Cloud Run, a VPS).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/travelbuddy.db TRUST_PROXY=1
RUN mkdir -p /data
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
