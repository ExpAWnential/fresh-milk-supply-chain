#!/usr/bin/env bash
#
# SPDX-License-Identifier: Apache-2.0
#
# The organisations this network runs, and the only place they are listed.
#
# Everything that used to be an unrolled branch per organisation reads from this table instead, so
# adding or removing one is a single line rather than an edit in six scripts.
#
# The newest bash on macOS is 3.2, which has no associative arrays, so each organisation is a
# colon-delimited record and the accessors below pull fields out of it.

# One organisation per company, so a certificate authority never issues identities for a business
# it has no relationship with, and an endorsement policy can name a role rather than a group of
# unrelated ones.
#
# name:mspId:domain:peerPort:chaincodePort:operationsPort:couchName:couchHostPort
ORG_DEFS=(
  "regulator:RegulatorMSP:regulator.example.com:7051:7052:9451:couchdb-regulator:5984"
  "farm:FarmMSP:farm.example.com:8051:8052:9452:couchdb-farm:6984"
  "processor:ProcessorMSP:processor.example.com:9051:9052:9453:couchdb-processor:7984"
  "logistics:LogisticsMSP:logistics.example.com:10051:10052:9454:couchdb-logistics:8984"
  "retailer:RetailerMSP:retailer.example.com:11051:11052:9455:couchdb-retailer:9984"
  "oracle:OracleMSP:oracle.example.com:12051:12052:9456:couchdb-oracle:10984"
)

orgNames() {
  local def
  for def in "${ORG_DEFS[@]}"; do
    echo "${def%%:*}"
  done
}

orgCount() {
  echo ${#ORG_DEFS[@]}
}

# Call this directly rather than inside $(...). fatalln exits, and an exit inside a subshell only
# ends the subshell, which would let a typo carry on with the previous organisation's environment.
requireOrg() {
  local def
  for def in "${ORG_DEFS[@]}"; do
    if [ "${def%%:*}" = "$1" ]; then
      return 0
    fi
  done
  fatalln "Unknown organisation '$1'. Expected one of: $(orgNames | tr '\n' ' ')"
}

# $1 organisation name, $2 one-based field number
orgField() {
  local def
  for def in "${ORG_DEFS[@]}"; do
    if [ "${def%%:*}" = "$1" ]; then
      echo "$def" | cut -d: -f"$2"
      return 0
    fi
  done
  echo "Unknown organisation '$1'" >&2
  return 1
}

orgMsp() { orgField "$1" 2; }
orgDomain() { orgField "$1" 3; }
orgPeerPort() { orgField "$1" 4; }
orgChaincodePort() { orgField "$1" 5; }
orgOpsPort() { orgField "$1" 6; }
orgCouchName() { orgField "$1" 7; }
orgCouchPort() { orgField "$1" 8; }

orgPeerHost() {
  echo "peer0.$(orgDomain "$1")"
}

orgTlsCa() {
  local domain
  domain=$(orgDomain "$1")
  echo "${MILK_NETWORK_HOME}/organizations/peerOrganizations/${domain}/tlsca/tlsca.${domain}-cert.pem"
}

orgAdminMsp() {
  local domain
  domain=$(orgDomain "$1")
  echo "${MILK_NETWORK_HOME}/organizations/peerOrganizations/${domain}/users/Admin@${domain}/msp"
}
