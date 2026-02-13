#!/bin/bash

# Production E2E Test Helper Script
# Makes it easy to run production tests with proper configuration

set -e

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║              Production E2E Testing with Sentry Tracing                   ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found"
    echo ""
    echo "Please create a .env file with:"
    echo "  PRODUCTION_URL=https://your-production-url.com/webhook"
    echo "  SENTRY_DSN=https://your-sentry-dsn@sentry.io/project"
    echo ""
    echo "Or set environment variables manually:"
    echo "  export PRODUCTION_URL=https://your-production-url.com/webhook"
    echo "  export SENTRY_DSN=https://your-sentry-dsn@sentry.io/project"
    echo ""
fi

# Load .env if it exists
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check if PRODUCTION_URL is set
if [ -z "$PRODUCTION_URL" ]; then
    echo "❌ ERROR: PRODUCTION_URL is not set"
    echo ""
    echo "Please set PRODUCTION_URL:"
    echo "  export PRODUCTION_URL=https://your-production-url.com/webhook"
    echo ""
    echo "Or add to .env file:"
    echo "  PRODUCTION_URL=https://your-production-url.com/webhook"
    echo ""
    exit 1
fi

# Check if SENTRY_DSN is set
if [ -z "$SENTRY_DSN" ]; then
    echo "⚠️  Warning: SENTRY_DSN is not set"
    echo "   Sentry tracing will be disabled"
    echo ""
    echo "To enable Sentry tracing:"
    echo "  export SENTRY_DSN=https://your-sentry-dsn@sentry.io/project"
    echo ""
    read -p "Continue without Sentry? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Set default TEST_COUNT if not set
if [ -z "$TEST_COUNT" ]; then
    TEST_COUNT=5
fi

echo "Configuration:"
echo "  Production URL: $PRODUCTION_URL"
echo "  Sentry DSN: ${SENTRY_DSN:+Enabled}"
echo "  Test Count: $TEST_COUNT"
echo ""

read -p "Run production E2E tests? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 0
fi

echo ""
echo "Running tests..."
echo ""

# Run the tests
npm run test:production

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                            Tests Complete                                  ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Review the test report above"
echo "  2. Run 'npm run analyze:sentry' for detailed analysis guide"
echo "  3. Check Sentry dashboard for trace details"
echo "  4. Fix any issues found"
echo "  5. Re-run tests to verify fixes"
echo ""
