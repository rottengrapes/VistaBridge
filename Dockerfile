# ==============================================================================
# VistaBridge Dynamic Production Dockerfile Template
# 100% Parameterized & Environment-Driven Template
# ==============================================================================

# Global Build Arguments
ARG NODE_VERSION=20-slim
ARG APP_DIR=/app

# ------------------------------------------------------------------------------
# 1. Base Image Stage
# ------------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ARG APP_DIR
WORKDIR ${APP_DIR}

# Install essential runtime tools (curl for healthcheck, certificates for HTTPS)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------------------
# 2. Dependencies Stage
# ------------------------------------------------------------------------------
FROM base AS deps
ARG APP_DIR
WORKDIR ${APP_DIR}

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install exact production dependencies using legacy-peer-deps for React 19 / Next.js 16
RUN npm ci --legacy-peer-deps

# ------------------------------------------------------------------------------
# 3. Builder Stage (Build-time Environment Inlining)
# ------------------------------------------------------------------------------
FROM base AS builder
ARG APP_DIR
WORKDIR ${APP_DIR}

# Copy cached dependencies and source files
COPY --from=deps ${APP_DIR}/node_modules ./node_modules
COPY . .

# Parameterized Build Arguments (Inherited from .env or passed via --build-arg)
ARG PORT=3007
ARG HOSTNAME=0.0.0.0
ARG NODE_ENV=production
ARG NEXT_TELEMETRY_DISABLED=1
ARG DB_TYPE=sqlite
ARG SQLITE_DB_PATH=/app/data/geovista.db
ARG GEOSERVER_URL=http://host.docker.internal:8080/geoserver
ARG NEXT_PUBLIC_GEOSERVER_URL=http://host.docker.internal:8080/geoserver
ARG NEXT_PUBLIC_TILESERV_URL=http://host.docker.internal:7800
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_ANALYTICS_URL=http://host.docker.internal:8000
ARG JWT_SECRET=""

# Populate Build-time Environment Variables for Next.js compilation
ENV PORT=${PORT} \
    HOSTNAME=${HOSTNAME} \
    NODE_ENV=${NODE_ENV} \
    NEXT_TELEMETRY_DISABLED=${NEXT_TELEMETRY_DISABLED} \
    DB_TYPE=${DB_TYPE} \
    SQLITE_DB_PATH=${SQLITE_DB_PATH} \
    GEOSERVER_URL=${GEOSERVER_URL} \
    NEXT_PUBLIC_GEOSERVER_URL=${NEXT_PUBLIC_GEOSERVER_URL} \
    NEXT_PUBLIC_TILESERV_URL=${NEXT_PUBLIC_TILESERV_URL} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_ANALYTICS_URL=${NEXT_PUBLIC_ANALYTICS_URL} \
    JWT_SECRET=${JWT_SECRET}

# Build Next.js production bundle
RUN npm run build

# ------------------------------------------------------------------------------
# 4. Production Runner Stage (Runtime Dynamic Template)
# ------------------------------------------------------------------------------
FROM base AS runner
ARG APP_DIR
WORKDIR ${APP_DIR}

# Runner Arguments to populate default environment variables
ARG PORT=3007
ARG HOSTNAME=0.0.0.0
ARG NODE_ENV=production
ARG NEXT_TELEMETRY_DISABLED=1
ARG DB_TYPE=sqlite
ARG SQLITE_DB_PATH=/app/data/geovista.db
ARG GEOSERVER_URL=http://host.docker.internal:8080/geoserver
ARG NEXT_PUBLIC_GEOSERVER_URL=http://host.docker.internal:8080/geoserver
ARG NEXT_PUBLIC_TILESERV_URL=http://host.docker.internal:7800
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_ANALYTICS_URL=http://host.docker.internal:8000
ARG JWT_SECRET=""

# 100% Parameterized Runtime Environment Variables
ENV PORT=${PORT} \
    HOSTNAME=${HOSTNAME} \
    NODE_ENV=${NODE_ENV} \
    NEXT_TELEMETRY_DISABLED=${NEXT_TELEMETRY_DISABLED} \
    DB_TYPE=${DB_TYPE} \
    SQLITE_DB_PATH=${SQLITE_DB_PATH} \
    GEOSERVER_URL=${GEOSERVER_URL} \
    NEXT_PUBLIC_GEOSERVER_URL=${NEXT_PUBLIC_GEOSERVER_URL} \
    NEXT_PUBLIC_TILESERV_URL=${NEXT_PUBLIC_TILESERV_URL} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_ANALYTICS_URL=${NEXT_PUBLIC_ANALYTICS_URL} \
    JWT_SECRET=${JWT_SECRET}

# Copy compiled Next.js build outputs and dependencies
COPY --from=builder ${APP_DIR}/package.json ./package.json
COPY --from=builder ${APP_DIR}/node_modules ./node_modules
COPY --from=builder ${APP_DIR}/.next ./.next
COPY --from=builder ${APP_DIR}/public ./public

# Dynamically ensure the persistent database directory exists
RUN sh -c "mkdir -p \$(dirname \${SQLITE_DB_PATH})"

# Dynamically expose the configured runtime port
EXPOSE ${PORT}

# Parameterized Container Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD sh -c "curl -f http://127.0.0.1:\${PORT}/api/config/public || exit 1"

# Dynamically start Next.js using injected runtime HOSTNAME and PORT
CMD ["sh", "-c", "npx next start -H ${HOSTNAME} -p ${PORT}"]
