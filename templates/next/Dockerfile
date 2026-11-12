# House template, TypeScript candidate. Two stages: build with development tools, run without them.
FROM node:22-alpine AS build
WORKDIR /app
# On the development profile the build is given the cloud session's proxy and its certificate: some
# HTTPS answers on that machine come with a certificate trusted only with a copy of it (package 0.6a,
# 12 Nov 2026). That proxy is not the machine's only way out: requests sent with no proxy also got
# answers (evidence/2026-11-12-package-0.6a/isolation-checks.md).
# The proxy's address is passed as a build argument that Docker predefines (HTTPS_PROXY, HTTP_PROXY):
# it reaches the build steps and, because it is not declared here, it is not recorded in the image's
# history. The certificate is copied into this build stage: the app image (the `run` stage) does not
# contain it; the tools image, which is this stage, does, on the development profile only.
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

# The tools image: creates the tables and the sample users, in a container, never on the machine
# that hosts the builder (package 0.5). It is the build stage, with its development tools, run as
# an unprivileged user. It is never started as the app and is not shipped to anyone.
FROM build AS tools
USER node
# The base image starts every command through a shell script, which adds settings of its own
# (PWD, SHLVL). The tools container runs its command directly, so that its environment is exactly
# the named list plus what the image declares.
ENTRYPOINT []
CMD ["node", "-e", "console.error('The tools image runs one named command at a time, e.g. drizzle-kit push or the seed.'); process.exit(1)"]

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
