#!/bin/sh
# Local dev with secrets read from the macOS keychain (never written to disk).
export PAYPAL_CLIENT_ID="$(security find-generic-password -s paypal-sandbox -a client_id -w)"
export PAYPAL_CLIENT_SECRET="$(security find-generic-password -s paypal-sandbox -a client_secret -w)"
export ANTHROPIC_API_KEY="$(security find-generic-password -s anthropic-api -a mandat -w)"
cd "$(dirname "$0")/apps/web" && exec pnpm "${1:-dev}"
