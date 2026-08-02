#!/usr/bin/env bash
#
# Copyright IBM Corp All Rights Reserved
#
# SPDX-License-Identifier: Apache-2.0
#

# This is a collection of bash functions used by different scripts

# Paths are built from this rather than from relative ones, because the scripts are invoked from
# more than one working directory and relative paths interact badly with FABRIC_CFG_PATH.
MILK_NETWORK_HOME=${MILK_NETWORK_HOME:-${PWD}}
. ${MILK_NETWORK_HOME}/scripts/utils.sh
. ${MILK_NETWORK_HOME}/scripts/orgs.sh

export CORE_PEER_TLS_ENABLED=true
export ORDERER_CA=${MILK_NETWORK_HOME}/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem

# Set environment variables for the peer org
setGlobals() {
  local USING_ORG=""
  if [ -z "$OVERRIDE_ORG" ]; then
    USING_ORG=$1
  else
    USING_ORG="${OVERRIDE_ORG}"
  fi

  # Fatal rather than a warning. This used to print "ORG Unknown" and carry on with whatever
  # organisation was exported last, so a typo installed chaincode on the wrong peer and reported
  # success.
  requireOrg "$USING_ORG"

  infoln "Using organization ${USING_ORG}"
  export CORE_PEER_LOCALMSPID=$(orgMsp "$USING_ORG")
  export CORE_PEER_TLS_ROOTCERT_FILE=$(orgTlsCa "$USING_ORG")
  export CORE_PEER_MSPCONFIGPATH=$(orgAdminMsp "$USING_ORG")
  export CORE_PEER_ADDRESS=localhost:$(orgPeerPort "$USING_ORG")

  if [ "$VERBOSE" = "true" ]; then
    env | grep CORE
  fi
}

# parsePeerConnectionParameters $@
# Helper function that sets the peer connection parameters for a chaincode
# operation
parsePeerConnectionParameters() {
  PEER_CONN_PARMS=()
  PEERS=""
  while [ "$#" -gt 0 ]; do
    setGlobals $1
    PEER=$(orgPeerHost $1)
    ## Set peer addresses
    if [ -z "$PEERS" ]
    then
	PEERS="$PEER"
    else
	PEERS="$PEERS $PEER"
    fi
    PEER_CONN_PARMS=("${PEER_CONN_PARMS[@]}" --peerAddresses $CORE_PEER_ADDRESS)
    ## Set path to TLS certificate
    TLSINFO=(--tlsRootCertFiles "$(orgTlsCa $1)")
    PEER_CONN_PARMS=("${PEER_CONN_PARMS[@]}" "${TLSINFO[@]}")
    # shift by one to get to the next organization
    shift
  done
}

verifyResult() {
  if [ $1 -ne 0 ]; then
    fatalln "$2"
  fi
}
