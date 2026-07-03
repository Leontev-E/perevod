FROM node:20-bookworm-slim

# php-cli is used only as a precise PHP tokenizer (token_get_all) to split
# inline-HTML from PHP code without ever executing the site.
RUN apt-get update \
 && apt-get install -y --no-install-recommends php-cli ca-certificates \
    chromium fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# used by the render-reviewer (verify/render.js)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "src/server.js"]
