#!/usr/bin/env bash
#
# Generates certificates for the six organisations and the orderer before their containers start.
#
# This script starts no containers. It writes into the host-backed network directory that peers and
# the orderer later mount.
set -euo pipefail

cd /app/fabric/milk-network

exec ./network.sh crypto
