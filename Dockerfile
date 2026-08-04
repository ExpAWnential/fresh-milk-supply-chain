# Builds the shared runtime used by application services and Fabric bootstrap jobs.
#
# Chaincode deployment needs both Node tooling and the Fabric CLI, so the image contains both rather
# than splitting bootstrap and application toolchains.

FROM hyperledger/fabric-tools:2.5.16 AS fabric

FROM node:22-bookworm-slim

# jq is used by the chaincode lifecycle scripts, curl by the seed step and the health checks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl jq \
  && rm -rf /var/lib/apt/lists/*

# network.sh resolves both the CLI and Fabric's default core.yaml from FABRIC_SAMPLES_HOME. Laying
# the binaries out in the shape it already expects means the scripts need no container-only paths.
COPY --from=fabric /usr/local/bin/ /opt/fabric/bin/
COPY --from=fabric /etc/hyperledger/fabric/ /opt/fabric/config/
ENV FABRIC_SAMPLES_HOME=/opt/fabric
ENV PATH="/opt/fabric/bin:${PATH}"

ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:${PATH}"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

COPY . .

# The committed lockfile pins every package, so release-age filtering adds delay without changing
# which dependency versions enter the image.
RUN pnpm install --frozen-lockfile --config.minimumReleaseAge=0 \
  && pnpm build

# The default command starts an organisation backend, which requires ORGANISATION. Compose supplies
# that identity or replaces the command for bootstrap and helper services.
CMD ["node", "services/backend/dist/index.js"]
