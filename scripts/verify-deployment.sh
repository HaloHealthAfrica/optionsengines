#!/bin/bash
# Deployment verification script

echo "=== Verifying Deployment ==="
echo ""

# Check backend health
echo "1. Checking backend health..."
BACKEND_URL="https://optionsengines.fly.dev"
HEALTH_RESPONSE=$(curl -s "$BACKEND_URL/health" || echo "FAILED")

if [[ $HEALTH_RESPONSE == *"healthy"* ]]; then
  echo "✅ Backend is healthy"
else
  echo "❌ Backend is not responding"
  echo "   Run: fly deploy -a optionsengines"
fi
echo ""

# Check if users table exists
echo "2. Checking if users table exists..."
echo "   Run this command to check:"
echo "   fly ssh console -a optionsengines"
echo "   psql \$DATABASE_URL -c \"SELECT COUNT(*) FROM users;\""
echo ""

# Check default admin user
echo "3. Checking default admin user..."
echo "   Run this command to verify:"
echo "   fly ssh console -a optionsengines"
echo "   psql \$DATABASE_URL -c \"SELECT email FROM users WHERE email = 'admin@optionagents.com';\""
echo ""

# Test registration endpoint
echo "4. Testing registration endpoint..."
REG_RESPONSE=$(curl -s -X POST "$BACKEND_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"test-'$(date +%s)'@example.com","password":"test123"}' || echo "FAILED")

if [[ $REG_RESPONSE == *"token"* ]]; then
  echo "✅ Registration endpoint works"
else
  echo "❌ Registration endpoint failed"
  echo "   Response: $REG_RESPONSE"
fi
echo ""

# Test login endpoint with default admin
echo "5. Testing login with default admin..."
LOGIN_RESPONSE=$(curl -s -X POST "$BACKEND_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@optionagents.com","password":"admin123"}' || echo "FAILED")

if [[ $LOGIN_RESPONSE == *"token"* ]]; then
  echo "✅ Login works with default admin"
else
  echo "❌ Login failed with default admin"
  echo "   Response: $LOGIN_RESPONSE"
  echo "   This means the migration hasn't been applied or the password is wrong"
  echo "   Run: fly ssh console -a optionsengines"
  echo "   Then: node dist/migrations/runner.js up"
fi
echo ""

echo "=== Frontend Checklist ==="
echo "□ Set VITE_API_URL in Vercel to: $BACKEND_URL"
echo "□ Redeploy frontend after setting environment variable"
echo "□ Check login page shows correct API URL at bottom"
echo ""

echo "=== Summary ==="
echo "If login still doesn't work:"
echo "1. Verify VITE_API_URL is set in Vercel"
echo "2. Run migrations: fly ssh console -a optionsengines && node dist/migrations/runner.js up"
echo "3. Check LOGIN_TROUBLESHOOTING.md for detailed steps"
