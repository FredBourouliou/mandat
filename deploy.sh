#!/bin/sh
# Deploys the current origin/main to Render and waits for it (Render API key read from the macOS keychain).
set -e
RK="$(security find-generic-password -s render-api -a mandat -w)"
SV="${RENDER_SERVICE:-srv-dbec9coae00c73cm5ea0}"
D=$(curl -s -X POST -H "Authorization: Bearer $RK" -H 'Content-Type: application/json' -d '{}' "https://api.render.com/v1/services/$SV/deploys" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
echo "deploy $D"
while :; do
  st=$(curl -s -H "Authorization: Bearer $RK" "https://api.render.com/v1/services/$SV/deploys/$D" | node -pe 'JSON.parse(require("fs").readFileSync(0)).status')
  echo "$(date +%T) $st"
  case $st in live) exit 0;; build_failed|update_failed|canceled|deactivated) exit 1;; esac
  sleep 15
done
