FROM node:20-alpine

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install

COPY server/prisma ./server/prisma
COPY server/src/scripts ./server/src/scripts

RUN npx prisma generate

COPY server/src ./server/src
COPY server/words.json ./server/words.json

RUN npm run build
RUN cp -r server/src/scripts server/dist/scripts

EXPOSE 3000

CMD ["npm", "start"]
