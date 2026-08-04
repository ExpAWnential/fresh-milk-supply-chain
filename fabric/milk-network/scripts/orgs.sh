#!/usr/bin/env bash
#
# SPDX-License-Identifier: Apache-2.0
#
# Defines the organisations shared by the network scripts. Colon-delimited records retain
# compatibility with macOS Bash 3.2, which has no associative arrays.

# Docker-only ports remain in the compose files where they take effect.
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

# Call directly because fatalln inside a command-substitution subshell cannot stop the parent script.
requireOrg() {
  local def
  for def in "${ORG_DEFS[@]}"; do
    if [ "${def%%:*}" = "$1" ]; then
      return 0
    fi
  done
  fatalln "Unknown organisation '$1'. Expected one of: $(orgNames | tr '\n' ' ')"
}

# $1 is the organisation name. $2 is the one-based field number.
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

# Host commands reach published localhost ports, while bootstrap containers use service names on
# the Compose network. FABRIC_ADDRESS_MODE selects the appropriate address family.
inContainerNetwork() {
  [ "${FABRIC_ADDRESS_MODE:-host}" = "container" ]
}

orgPeerAddress() {
  if inContainerNetwork; then
    echo "$(orgPeerHost "$1"):$(orgPeerPort "$1")"
  else
    echo "localhost:$(orgPeerPort "$1")"
  fi
}

ordererAddress() {
  if inContainerNetwork; then
    echo "orderer.example.com:7050"
  else
    echo "localhost:7050"
  fi
}

# The orderer's channel participation API, which osnadmin uses to join the channel.
ordererAdminAddress() {
  if inContainerNetwork; then
    echo "orderer.example.com:7053"
  else
    echo "localhost:7053"
  fi
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
