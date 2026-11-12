# House template, TypeScript candidate. Two stages: build with development tools, run without them.
FROM node:22-alpine AS build
WORKDIR /app
# The development machine reaches the internet only through a proxy with its own certificate.
# Both are passed in as build arguments and used only during the build. Neither is in the image.
ARG HTTPS_PROXY
ARG HTTP_PROXY
ARG NODE_EXTRA_CA_CERTS
COPY certs/ /certs/
RUN if [ -f /certs/session-ca.crt ]; then npm config set cafile /certs/session-ca.crt; fi
COPY package.json package-lock.json ./
# The empty stand-in for the image library sharp, which is deliberately not installed (see README).
COPY vendor/ ./vendor/
RUN npm ci --no-fund --no-audit
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The build needs no database or secret: pages that need them render at request time.
RUN DATABASE_URL=postgres://build:build@localhost/build AUTH_SECRET=build-time-placeholder-not-a-secret-0000 npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
