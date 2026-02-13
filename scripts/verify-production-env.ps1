# Production Environment Verification Script (PowerShell)
# Run this after deployment to verify required env vars are set.
# Usage: .\scripts\verify-production-env.ps1

Write-Host "=== Production Environment Verification ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "--- Backend (Fly.io) ---" -ForegroundColor Yellow
if (Get-Command fly -ErrorAction SilentlyContinue) {
    Write-Host "Checking Fly.io secrets (run: fly secrets list)..."
    fly secrets list 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  (Run 'fly secrets list' manually to verify)" -ForegroundColor Gray
    }
} else {
    Write-Host "  (fly CLI not installed - check https://fly.io/docs/hands-on/install-flyctl/)" -ForegroundColor Gray
}
Write-Host ""
Write-Host "Required in Fly.io:"
Write-Host "  [ ] UNUSUAL_WHALES_API_KEY - for options chain/price fallback"
Write-Host "  [ ] ENABLE_CRON_PROCESSING - set to 'false' when workers run"
Write-Host "  [ ] MAX_OPEN_POSITIONS - position limit (default 5)"
Write-Host "  [ ] REDIS_URL - for cache (required in production)"
Write-Host "  [ ] DATABASE_URL, JWT_SECRET, HMAC_SECRET, ALPACA_*, MARKET_DATA_API_KEY"
Write-Host ""

Write-Host "--- Frontend (Vercel) ---" -ForegroundColor Yellow
Write-Host "Required in Vercel:"
Write-Host "  [ ] NEXT_PUBLIC_API_URL - Backend URL (e.g. https://your-app.fly.dev)"
Write-Host "  [ ] CRON_SECRET - when using Vercel cron for process-queue"
Write-Host ""
Write-Host "When Fly.io workers run: set ENABLE_CRON_PROCESSING=false in Vercel crons"
Write-Host "  (prevents duplicate processing - workers handle the queue)"
Write-Host ""

Write-Host "=== Verification complete ===" -ForegroundColor Cyan
