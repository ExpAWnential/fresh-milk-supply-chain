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
# The chaincode, operations and CouchDB ports are not here: they are only ever read by Docker, so
# they live in the compose files where they take effect. A copy here would look authoritative and
# change nothing.
#
# name:mspId:domain:peerPort
ORG_DEFS=(
  "regulator:RegulatorMSP:regulator.example.com:7051"
  "farm:FarmMSP:farm.example.com:8051"
  "processor:ProcessorMSP:processor.example.com:9051"
  "logistics:LogisticsMSP:logistics.example.com:10051"
  "retailer:RetailerMSP:retailer.example.com:11051"
  "oracle:OracleMSP:oracle.example.com:12051"
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

# $1 organisation name, $2 one-based field number. Uses parameter expansion rather than cut so
# that reading a field does not fork a process; setGlobals reads four of them, on every one of the
# roughly eighty calls a deploy makes.
orgField() {
  local def rest
  for def in "${ORG_DEFS[@]}"; do
    if [ "${def%%:*}" = "$1" ]; then
      rest=$def
      local i=1
      while [ $i -lt "$2" ]; do
        rest=${rest#*:}
        i=$((i + 1))
      done
      echo "${rest%%:*}"
      return 0
    fi
  done
  echo "Unknown organisation '$1'" >&2
  return 1
}

orgMsp() { orgField "$1" 2; }
orgDomain() { orgField "$1" 3; }
orgPeerPort() { orgField "$1" 4; }

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
