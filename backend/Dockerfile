FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json backend/
RUN npm install

FROM deps AS build
COPY backend backend
RUN npm run build -w backend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY backend/package*.json backend/
RUN npm install --omit=dev
COPY --from=build /app/backend/dist backend/dist
CMD ["npm", "run", "start", "-w", "backend"]
