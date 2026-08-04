#!/usr/bin/env bash
#
# Builds, packages, installs, approves and commits both chaincodes after channel creation.
#
# Fabric builds one container per chaincode and organisation. Each build installs its own npm
# dependencies, so this step can remain quiet for several minutes.
#
# No -u, for the same reason as the channel phase: Fabric's sourced scripts read variables they
# deliberately leave unset.
set -eo pipefail

cd /app/fabric/milk-network

CHANNEL=${FABRIC_CHANNEL_NAME:-milkchannel}

export MILK_NETWORK_HOME=$PWD
export FABRIC_CFG_PATH=$FABRIC_SAMPLES_HOME/config
. scripts/envVar.sh

# sed rather than head, which would close the pipe early and trip pipefail on the SIGPIPE.
setGlobals "$(orgNames | sed -n 1p)" > /dev/null

isCommitted() {
  peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$1" > /dev/null 2>&1
}

# Checked per chaincode rather than for the pair, because a run interrupted between the two leaves
# the first committed. Committing again at a sequence already committed is a hard error, not a
# no-op, so a re-run has to deploy only what is missing.
for chaincode in stakeholder supplychain; do
  if isCommitted "$chaincode"; then
    echo "chaincode: '${chaincode}' is already committed on '${CHANNEL}', skipping"
    continue
  fi

  echo "chaincode: deploying '${chaincode}', this takes a few minutes"
  (cd /app && pnpm fabric:deploy-chaincode -- --chaincode "$chaincode")
done

echo "chaincode: stakeholder and supplychain are committed on '${CHANNEL}'"
