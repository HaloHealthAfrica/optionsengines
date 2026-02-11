#!/bin/bash
# Script to set Fly.io secrets for deployment
# Run this with: bash set-fly-secrets.sh

echo "Setting Fly.io secrets for optionsengines..."

# Generate random secrets if needed
JWT_SECRET=$(openssl rand -base64 48)
HMAC_SECRET=$(openssl rand -base64 48)

# Required secrets - REPLACE THESE WITH YOUR ACTUAL VALUES
fly secrets set \
  DATABASE_URL="postgresql://your-neon-connection-string-here" \
  JWT_SECRET="$JWT_SECRET" \
  HMAC_SECRET="$HMAC_SECRET" \
  ALPACA_API_KEY="your-alpaca-key" \
  ALPACA_SECRET_KEY="your-alpaca-secret" \
  TWELVE_DATA_API_KEY="your-twelvedata-key" \
  MARKET_DATA_API_KEY="your-marketdata-key" \
  -a optionsengines

echo "Secrets set successfully!"
echo ""
echo "Generated JWT_SECRET: $JWT_SECRET"
echo "Generated HMAC_SECRET: $HMAC_SECRET"
echo ""
echo "IMPORTANT: Save these secrets somewhere safe!"
