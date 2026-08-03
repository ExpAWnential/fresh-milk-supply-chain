#!/usr/bin/env bash

# Installs and approves one chaincode for every consortium organisation, then commits the definition
# only after the channel reports that the required approvals are present.

source scripts/utils.sh

CHANNEL_NAME=${1:-"mychannel"}
CC_NAME=${2}
CC_SRC_PATH=${3}
CC_SRC_LANGUAGE=${4}
CC_VERSION=${5:-"1.0"}
CC_SEQUENCE=${6:-"1"}
CC_INIT_FCN=${7:-"NA"}
CC_END_POLICY=${8:-"NA"}
CC_COLL_CONFIG=${9:-"NA"}
DELAY=${10:-"3"}
MAX_RETRY=${11:-"5"}
VERBOSE=${12:-"false"}

println "executing with the following"
println "- CHANNEL_NAME: ${C_GREEN}${CHANNEL_NAME}${C_RESET}"
println "- CC_NAME: ${C_GREEN}${CC_NAME}${C_RESET}"
println "- CC_SRC_PATH: ${C_GREEN}${CC_SRC_PATH}${C_RESET}"
println "- CC_SRC_LANGUAGE: ${C_GREEN}${CC_SRC_LANGUAGE}${C_RESET}"
println "- CC_VERSION: ${C_GREEN}${CC_VERSION}${C_RESET}"
println "- CC_SEQUENCE: ${C_GREEN}${CC_SEQUENCE}${C_RESET}"
println "- CC_END_POLICY: ${C_GREEN}${CC_END_POLICY}${C_RESET}"
println "- CC_COLL_CONFIG: ${C_GREEN}${CC_COLL_CONFIG}${C_RESET}"
println "- CC_INIT_FCN: ${C_GREEN}${CC_INIT_FCN}${C_RESET}"
println "- DELAY: ${C_GREEN}${DELAY}${C_RESET}"
println "- MAX_RETRY: ${C_GREEN}${MAX_RETRY}${C_RESET}"
println "- VERBOSE: ${C_GREEN}${VERBOSE}${C_RESET}"

INIT_REQUIRED="--init-required"
if [ "$CC_INIT_FCN" = "NA" ]; then
  INIT_REQUIRED=""
fi

if [ "$CC_END_POLICY" = "NA" ]; then
  CC_END_POLICY=""
else
  # Every use of this variable below is an unquoted expansion, relying on word splitting to
  # separate the flag from its value. A space inside the policy would split it across arguments as
  # well, and the peer rejects that with a parse error that says nothing about whitespace.
  case "$CC_END_POLICY" in
    *" "*)
      fatalln "The endorsement policy must not contain spaces: '${CC_END_POLICY}'"
      ;;
  esac
  CC_END_POLICY="--signature-policy $CC_END_POLICY"
fi

if [ "$CC_COLL_CONFIG" = "NA" ]; then
  CC_COLL_CONFIG=""
else
  CC_COLL_CONFIG="--collections-config $CC_COLL_CONFIG"
fi

FABRIC_CFG_PATH=${FABRIC_SAMPLES_HOME}/config/

. scripts/envVar.sh
. scripts/ccutils.sh

function checkPrereqs() {
  jq --version > /dev/null 2>&1

  if [[ $? -ne 0 ]]; then
    errorln "jq command not found..."
    errorln
    errorln "Follow the instructions in the Fabric docs to install the prereqs"
    errorln "https://hyperledger-fabric.readthedocs.io/en/latest/prereqs.html"
    exit 1
  fi
}

checkPrereqs

./scripts/packageCC.sh $CC_NAME $CC_SRC_PATH $CC_SRC_LANGUAGE $CC_VERSION 

PACKAGE_ID=$(peer lifecycle chaincode calculatepackageid ${CC_NAME}.tar.gz)

for org in $(orgNames); do
  infoln "Installing chaincode on peer0.${org}..."
  installChaincode $org
done

resolveSequence

queryInstalled $(orgNames | head -1)

for org in $(orgNames); do
  approveForMyOrg $org
done

# Readiness is channel state, so one check after all approvals avoids thirty-six polled calls.
EXPECTED_APPROVALS=()
for org in $(orgNames); do
  EXPECTED_APPROVALS=("${EXPECTED_APPROVALS[@]}" "\"$(orgMsp $org)\": true")
done
checkCommitReadiness $(orgNames | head -1) "${EXPECTED_APPROVALS[@]}"

# Commit validation uses the channel's LifecycleEndorsement policy, so offer every peer.
commitChaincodeDefinition $(orgNames)

# The committed definition is channel state, so one peer can confirm it for all organisations.
queryCommitted $(orgNames | head -1)

if [ "$CC_INIT_FCN" = "NA" ]; then
  infoln "Chaincode initialization is not required"
else
  chaincodeInvokeInit $(orgNames)
fi

exit 0
