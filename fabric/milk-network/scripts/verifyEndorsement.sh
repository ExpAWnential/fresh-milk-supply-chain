#!/usr/bin/env bash
#
# SPDX-License-Identifier: Apache-2.0
#
# Proves the supply-chain chaincode's endorsement policy actually rejects a transaction that the
# regulator has not endorsed. Run against a network with the chaincode deployed and a batch that
# is IN_TRANSIT.
#
#   ./scripts/verifyEndorsement.sh BATCH-001
#
# The rejecting cases run first because they leave the batch untouched; the accepting case moves it
# to DELIVERED and can only run once.

set -u

ROOTDIR=$(cd "$(dirname "$0")/.." && pwd)
export MILK_NETWORK_HOME=$ROOTDIR
export FABRIC_SAMPLES_HOME=${FABRIC_SAMPLES_HOME:-${HOME}/fabric-samples}
export PATH=${FABRIC_SAMPLES_HOME}/bin:$PATH
export FABRIC_CFG_PATH=${FABRIC_SAMPLES_HOME}/config

cd "$ROOTDIR"
. scripts/envVar.sh

BATCH=${1:-BATCH-001}

# Signs as the retailer's registered user rather than an organisation admin. Only the users in the
# stakeholder registry can call the contract at all, so an admin would be refused by the role check
# before the endorsement policy was ever reached, and every case would fail for the wrong reason.
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
  # Built with += rather than by re-expanding the array: bash 3.2 treats expanding an empty array
  # as an unbound variable, which set -u turns into a fatal error on the first iteration.
  local peers=()
  for org in $orgs; do
    requireOrg "$org"
    peers+=(--peerAddresses "localhost:$(orgPeerPort $org)" --tlsRootCertFiles "$(orgTlsCa $org)")
  done

  # --waitForEvent is required. A transaction that fails the policy is still ordered and written
  # into a block as invalid, so without waiting for the commit event this reports success for a
  # transaction that was discarded, and every case below would appear to pass.
  local out
  out=$(peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
        --tls --cafile "$ORDERER_CA" -C "${CHANNEL_NAME:-milkchannel}" -n supplychain --waitForEvent \
        -c "{\"function\":\"BatchLifecycleContract:recordDelivery\",\"Args\":[\"${BATCH}\",\"Sydney Depot\"]}" \
        "${peers[@]}" 2>&1)

  local got=committed
  echo "$out" | grep -qi "ENDORSEMENT_POLICY_FAILURE" && got=ENDORSEMENT_POLICY_FAILURE
  echo "$out" | grep -qi "could not assemble\|no combination of peers" && got=policy-unsatisfiable

  if [ "$got" = "$expected" ]; then
    printf "  %-44s %-28s PASS\n" "$label" "$got"
  else
    printf "  %-44s %-28s FAIL (expected %s)\n" "$label" "$got" "$expected"
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
