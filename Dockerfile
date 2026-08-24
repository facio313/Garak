# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22.23.2-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG GARAK_BASE_PATH=/garak
ARG GARAK_PUBLIC_URL=https://bonifacio.work/garak/
ARG PORTFOLIO_BRANCH
ARG PORTFOLIO_AUTH_MODE
ENV GARAK_BASE_PATH=${GARAK_BASE_PATH} \
    GARAK_PUBLIC_URL=${GARAK_PUBLIC_URL} \
    GARAK_SELF_HOSTED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PORTFOLIO_AUTH_MODE=${PORTFOLIO_AUTH_MODE} \
    PORTFOLIO_BRANCH=${PORTFOLIO_BRANCH}
COPY . .
RUN sh scripts/portfolio-auth-mode.sh check \
    && npm run build \
    && test -x dist/standalone/server.js

FROM ${NODE_IMAGE} AS runtime
ARG GARAK_BASE_PATH=/garak
ARG GARAK_PUBLIC_URL=https://bonifacio.work/garak/
ARG GIT_SHA
ARG PORTFOLIO_BRANCH
ARG PORTFOLIO_AUTH_MODE
ENV GARAK_BASE_PATH=${GARAK_BASE_PATH} \
    GARAK_PUBLIC_URL=${GARAK_PUBLIC_URL} \
    GARAK_SELF_HOSTED=1 \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=3000 \
    PORTFOLIO_AUTH_MODE=${PORTFOLIO_AUTH_MODE} \
    PORTFOLIO_BRANCH=${PORTFOLIO_BRANCH}
LABEL org.opencontainers.image.source="https://github.com/facio313/Garak" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      work.bonifacio.portfolio.auth-mode="${PORTFOLIO_AUTH_MODE}" \
      work.bonifacio.portfolio.branch="${PORTFOLIO_BRANCH}"

WORKDIR /app
RUN addgroup -S -g 10001 garak \
    && adduser -S -D -H -u 10001 -G garak garak
COPY --from=build --chown=10001:10001 /app/dist/standalone ./
COPY --chown=0:0 scripts/portfolio-auth-mode.sh /usr/local/bin/portfolio-auth-mode
RUN chmod 0555 /usr/local/bin/portfolio-auth-mode \
    && normalized_branch="${PORTFOLIO_BRANCH#refs/heads/}" \
    && printf '%s\n%s\n' "$normalized_branch" "$PORTFOLIO_AUTH_MODE" > /etc/portfolio-auth-build \
    && chmod 0444 /etc/portfolio-auth-build \
    && /usr/local/bin/portfolio-auth-mode check

USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 \
  CMD ["node", "-e", "const p=process.env.GARAK_BASE_PATH||'';fetch('http://127.0.0.1:3000'+p+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/local/bin/portfolio-auth-mode", "exec", "--"]
CMD ["node", "server.js"]
