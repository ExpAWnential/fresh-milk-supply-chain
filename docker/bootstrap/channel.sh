#!/usr/bin/env bash
#
# Creates the application channel, joins all six peers and configures their anchor peers.
#
# No -u here. Fabric's own scripts are sourced below and read variables they leave unset on purpose,
# such as OVERRIDE_ORG, so treating that as an error stops the phase before it starts.
set -eo pipefail

cd /app/fabric/milk-network

CHANNEL=${FABRIC_CHANNEL_NAME:-milkchannel}

export MILK_NETWORK_HOME=$PWD
export FABRIC_CFG_PATH=$FABRIC_SAMPLES_HOME/config
. scripts/envVar.sh

# sed rather than head, because head closes the pipe on the first line and pipefail then reports the
# resulting SIGPIPE as a failed phase.
FIRST_ORG=$(orgNames | sed -n 1p)
setGlobals "$FIRST_ORG" > /dev/null

# An open port does not mean the peer can serve Fabric requests. Wait until the CLI succeeds before
# creating the channel. `peer channel list` also succeeds before the peer has joined any channel.
for attempt in $(seq 1 60); do
  if peer channel list > /dev/null 2>&1; then
    break
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "channel: peer0.${FIRST_ORG} never became ready" >&2
    exit 1
  fi

  sleep 2
done

# createChannel.sh joins every peer unconditionally, and a second join is an error rather than a
# no-op, so the whole phase is skipped once the channel exists.
if peer channel list 2>/dev/null | grep -qw "$CHANNEL"; then
  echo "channel: '${CHANNEL}' already exists, leaving it alone"
  exit 0
fi

exec ./network.sh channel -c "$CHANNEL"
