# Hosted MCP server (src/http.js) for mcp.tickets.dev. Deploy with: fly deploy
FROM node:22.20.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/http.js"]
