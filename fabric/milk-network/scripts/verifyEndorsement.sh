#!/usr/bin/env bash
#
# SPDX-License-Identifier: Apache-2.0
#
# Checks that delivery needs the regulator's endorsement and a network majority. Run against a
# deployed network with an IN_TRANSIT batch.
#
#   ./scripts/verifyEndorsement.sh BATCH-001
#
# Rejecting cases run first because the successful case delivers the batch and cannot be repeated.

set -u

ROOTDIR=$(cd "$(dirname "$0")/.." && pwd)
export MILK_NETWORK_HOME=$ROOTDIR
export FABRIC_SAMPLES_HOME=${FABRIC_SAMPLES_HOME:-${HOME}/fabric-samples}
export PATH=${FABRIC_SAMPLES_HOME}/bin:$PATH
export FABRIC_CFG_PATH=${FABRIC_SAMPLES_HOME}/config

cd "$ROOTDIR"
. scripts/envVar.sh

BATCH=${1:-BATCH-001}

# Use the registered retailer identity so failures exercise endorsement rather than role checks.
signAsRetailer() {
  export CORE_PEER_LOCALMSPID=$(orgMsp retailer)
  export CORE_PEER_TLS_ROOTCERT_FILE=$(orgTlsCa retailer)
  export CORE_PEER_ADDRESS=localhost:$(orgPeerPort retailer)
  export CORE_PEER_MSPCONFIGPATH=${MILK_NETWORK_HOME}/organizations/peerOrganizations/retailer.example.com/users/User1@retailer.example.com/msp
}

# $1 label, $2 endorsing organisations, $3 expected outcome
attempt() {
  local label=$1 orgs=$2 expected=$3

  signAsRetailer
  # Bash 3.2 and set -u require appending instead of re-expanding an empty array.
  local peers=()
  for org in $orgs; do
    requireOrg "$org"
    peers+=(--peerAddresses "localhost:$(orgPeerPort $org)" --tlsRootCertFiles "$(orgTlsCa $org)")
  done

  # Wait for commit because an ordered transaction may still be invalidated by endorsement policy.
  local out status
  out=$(peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
        --tls --cafile "$ORDERER_CA" -C "${CHANNEL_NAME:-milkchannel}" -n supplychain --waitForEvent \
        -c "{\"function\":\"BatchLifecycleContract:recordDelivery\",\"Args\":[\"${BATCH}\",\"Sydney Depot\"]}" \
        "${peers[@]}" 2>&1)
  status=$?

  # Treat only an explicit successful commit as committed. Other errors remain unexpected failures.
  local got=unexpected-failure
  if [ $status -eq 0 ] && echo "$out" | grep -q "status:200"; then
    got=committed
  fi
  echo "$out" | grep -qi "ENDORSEMENT_POLICY_FAILURE" && got=ENDORSEMENT_POLICY_FAILURE
  echo "$out" | grep -qi "could not assemble\|no combination of peers" && got=policy-unsatisfiable

  if [ "$got" = "$expected" ]; then
    printf "  %-44s %-28s PASS\n" "$label" "$got"
  else
    printf "  %-44s %-28s FAIL (expected %s)\n" "$label" "$got" "$expected"
    # Include the peer's diagnostic for unexpected failures.
    printf "    %s\n" "$(echo "$out" | tail -3)"
    FAILURES=$((FAILURES + 1))
  fi
}

FAILURES=0
infoln "Checking that cold-chain evidence cannot be written without the regulator"

attempt "four others, no regulator"  "farm processor logistics retailer" ENDORSEMENT_POLICY_FAILURE
attempt "regulator but only two others" "regulator farm processor"      ENDORSEMENT_POLICY_FAILURE
attempt "regulator and three others"    "regulator farm processor logistics" committed

if [ $FAILURES -eq 0 ]; then
  successln "The endorsement policy behaves as intended."
else
  fatalln "${FAILURES} endorsement check(s) did not behave as intended."
fi
