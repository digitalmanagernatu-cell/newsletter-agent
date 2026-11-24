# Agente de newsletters. Imagen con Chromium para las capturas (misma versión que la dependencia playwright).
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Madrid PORT=3002
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY agents/newsletter/package.json agents/newsletter/
RUN npm ci --omit=dev --workspace @natu/agent-newsletter --workspace @natu/shared && npm cache clean --force
COPY shared shared
COPY brand brand
COPY agents/newsletter agents/newsletter
RUN rm -rf agents/newsletter/out agents/newsletter/test
USER pwuser
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "agents/newsletter/src/server.ts"]
