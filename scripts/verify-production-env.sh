#!/bin/bash
# Production Environment Verification Script
# Run this after deployment to verify required env vars are set.
# Usage: ./scripts/verify-production-env.sh

set -e
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== Production Environment Verification ==="
echo ""

# Fly.io (Backend) - use fly secrets list if available
echo "--- Backend (Fly.io) ---"
if command -v fly &>/dev/null; then
  echo "Checking Fly.io secrets (run: fly secrets list)..."
  fly secrets list 2>/dev/null || echo "  (Run 'fly secrets list' manually to verify)"
  echo ""
  echo "Required in Fly.io:"
  echo "  □ UNUSUAL_WHALES_API_KEY - for options chain/price fallback"
  echo "  □ ENABLE_CRON_PROCESSING - set to 'false' when workers run"
  echo "  □ MAX_OPEN_POSITIONS - position limit (default 5)"
  echo "  □ REDIS_URL - for cache (required in production)"
  echo "  □ DATABASE_URL, JWT_SECRET, HMAC_SECRET, ALPACA_*, MARKET_DATA_API_KEY"
else
  echo "  (fly CLI not installed - check https://fly.io/docs/hands-on/install-flyctl/)"
fi
echo ""

# Vercel (Frontend)
echo "--- Frontend (Vercel) ---"
echo "Required in Vercel:"
echo "  □ NEXT_PUBLIC_API_URL - Backend URL (e.g. https://your-app.fly.dev)"
echo "  □ CRON_SECRET - when using Vercel cron for process-queue"
echo ""
echo "When Fly.io workers run: set ENABLE_CRON_PROCESSING=false in Vercel crons"
echo "  (prevents duplicate processing - workers handle the queue)"
echo ""

echo "=== Verification complete ==="
