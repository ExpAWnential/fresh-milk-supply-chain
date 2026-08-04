#!/usr/bin/env bash

# Joins the local ordering service to an application channel through the authenticated admin API.
channel_name=$1

export PATH=${FABRIC_SAMPLES_HOME:-${HOME}/fabric-samples}/bin:$PATH
export ORDERER_ADMIN_TLS_SIGN_CERT=${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt /dev/null 2>&1
export ORDERER_ADMIN_TLS_PRIVATE_KEY=${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.key /dev/null 2>&1

osnadmin channel join --channelID ${channel_name} --config-block ./channel-artifacts/${channel_name}.block -o $(ordererAdminAddress) --ca-file "$ORDERER_CA" --client-cert "$ORDERER_ADMIN_TLS_SIGN_CERT" --client-key "$ORDERER_ADMIN_TLS_PRIVATE_KEY" >> log.txt 2>&1
