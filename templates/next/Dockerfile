# House template, TypeScript candidate. Two stages: build with development tools, run without them.
# Both base images are pinned to the digest the owner approved for internal development and testing only
# (13 Nov 2026, question 11 (a); builder/approved-images.json). The builder's check fails on any other.
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS build
WORKDIR /app
# On the development profile the sandbox manager runs this build on the host's network and gives it, as
# build arguments that Docker predefines (HTTPS_PROXY, HTTP_PROXY), the project's egress proxy on the
# machine's loopback address, with the package registry as its only allowed host; that proxy goes out
# through the cloud session's proxy (package 0.6c). Because the arguments are not declared here, they are
# not recorded in the image's history. No certificate is given to the build: npm's HTTPS goes through the
# proxy as a tunnel, and the registry's own certificate is checked against the image's public roots.
COPY package.json package-lock.json ./
# The empty stand-in for the image library sharp, which is deliberately not installed (see README).
COPY vendor/ ./vendor/
# Install scripts off: no package's script, and nothing a project's workspace adds, runs while the network
# is open (package 0.6c; a script planted in vendor/ ran with plain `npm ci`, not with this flag).
RUN npm ci --ignore-scripts --no-fund --no-audit
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The guard check and the build run the workspace's own code, so they get no network at all.
# The build needs no database or secret: pages that need them render at request time.
RUN --network=none DATABASE_URL=postgres://build:build@localhost/build AUTH_SECRET=build-time-placeholder-not-a-secret-0000 npm run build

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

FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
