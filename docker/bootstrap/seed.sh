#!/usr/bin/env bash
#
# Registers the consortium identities and sensor keys after all application backends are healthy.
#
# Ports and stakeholder IDs come from the organisation directory. Sensor public keys come from the
# sensor package, which keeps this bootstrap script from maintaining separate copies.
set -euo pipefail

REGULATOR_URL=${REGULATOR_BACKEND_URL:-http://backend-regulator:3001}
SENSOR_KEY_DIR=${SENSOR_KEY_DIR:-/app/services/sensor/data}

waitFor() {
  local url=$1 description=$2 attempt

  for attempt in $(seq 1 60); do
    if curl -fsS "$url" > /dev/null 2>&1; then
      return 0
    fi

    sleep 2
  done

  echo "seed: ${description} never answered at ${url}" >&2
  return 1
}

post() {
  curl -fsS -X POST "$1" -H 'content-type: application/json' -d "$2" > /dev/null
}

waitFor "$REGULATOR_URL/identity" "the regulator's backend"

directory=$(curl -fsS "$REGULATOR_URL/organisations")
regulatorId=$(echo "$directory" | jq -r '.[] | select(.name == "regulator") | .stakeholderId')

if curl -fsS "$REGULATOR_URL/stakeholders/${regulatorId}" > /dev/null 2>&1; then
  echo "seed: ${regulatorId} is already registered, leaving the registry alone"
  exit 0
fi

echo "seed: bootstrapping ${regulatorId}"
post "$REGULATOR_URL/stakeholders/bootstrap" "$(jq -nc --arg id "$regulatorId" '{stakeholderId: $id}')"

# Every registration is signed by the regulator, but the certificate being registered belongs to the
# company, so each one has to report its own before it can be named.
for name in $(echo "$directory" | jq -r '.[] | select(.name != "regulator") | .name'); do
  port=$(echo "$directory" | jq -r --arg n "$name" '.[] | select(.name == $n) | .origin | split(":") | last')
  backend="http://backend-${name}:${port}"

  waitFor "${backend}/identity" "the ${name}'s backend"
  identity=$(curl -fsS "${backend}/identity")

  echo "seed: registering ${name}"
  post "$REGULATOR_URL/stakeholders" "$(jq -nc \
    --arg id "$(echo "$identity" | jq -r .stakeholderId)" \
    --arg role "$(echo "$name" | tr '[:lower:]' '[:upper:]')" \
    --arg certificate "$(echo "$identity" | jq -r .certificateId)" \
    '{stakeholderId: $id, role: $role, certificateId: $certificate}')"
done

# Readings are signed by the sensor, and nobody can check one of those signatures until the
# regulator has put the matching public key on the ledger.
for publicKeyFile in "$SENSOR_KEY_DIR"/*.pub; do
  sensorId=$(basename "$publicKeyFile" .pub)

  echo "seed: registering ${sensorId}'s public key"
  post "$REGULATOR_URL/sensors" "$(jq -nc \
    --arg id "$sensorId" \
    --arg publicKey "$(cat "$publicKeyFile")" \
    '{sensorId: $id, publicKey: $publicKey, algorithm: "ed25519"}')"
done

echo "seed: the six companies and their sensor keys are on the ledger"
