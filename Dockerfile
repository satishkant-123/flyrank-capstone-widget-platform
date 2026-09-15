FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production || npm install --omit=dev

COPY . .

RUN npm run seed

EXPOSE 3000 5500

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npm", "start"]
