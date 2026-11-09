# For hosts that run containers (Fly.io, Railway, Google Cloud Run, a VPS).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/travelbuddy.db TRUST_PROXY=1
# Attach a persistent volume at /data on your host (Railway rejects the VOLUME keyword).
RUN mkdir -p /data
EXPOSE 3000
CMD ["npm", "start"]
