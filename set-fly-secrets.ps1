# PowerShell script to set Fly.io secrets for deployment
# Run this with: .\set-fly-secrets.ps1

Write-Host "Setting Fly.io secrets for optionsengines..." -ForegroundColor Green

# Generate random secrets
$JWT_SECRET = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | ForEach-Object {[char]$_})
$HMAC_SECRET = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | ForEach-Object {[char]$_})

Write-Host ""
Write-Host "Generated secrets:" -ForegroundColor Yellow
Write-Host "JWT_SECRET: $JWT_SECRET"
Write-Host "HMAC_SECRET: $HMAC_SECRET"
Write-Host ""
Write-Host "IMPORTANT: Save these secrets somewhere safe!" -ForegroundColor Red
Write-Host ""

# Set the secrets - REPLACE THE PLACEHOLDER VALUES WITH YOUR ACTUAL VALUES
$secrets = @(
    "DATABASE_URL=postgresql://your-neon-connection-string-here",
    "JWT_SECRET=$JWT_SECRET",
    "HMAC_SECRET=$HMAC_SECRET",
    "ALPACA_API_KEY=your-alpaca-key",
    "ALPACA_SECRET_KEY=your-alpaca-secret",
    "TWELVE_DATA_API_KEY=your-twelvedata-key",
    "MARKET_DATA_API_KEY=your-marketdata-key"
)

Write-Host "Setting secrets in Fly.io..." -ForegroundColor Green
Write-Host ""
Write-Host "Run these commands manually with your actual values:" -ForegroundColor Yellow
Write-Host ""
Write-Host "fly secrets set DATABASE_URL='your-neon-connection-string' -a optionsengines"
Write-Host "fly secrets set JWT_SECRET='$JWT_SECRET' -a optionsengines"
Write-Host "fly secrets set HMAC_SECRET='$HMAC_SECRET' -a optionsengines"
Write-Host "fly secrets set ALPACA_API_KEY='your-alpaca-key' -a optionsengines"
Write-Host "fly secrets set ALPACA_SECRET_KEY='your-alpaca-secret' -a optionsengines"
Write-Host "fly secrets set TWELVE_DATA_API_KEY='your-twelvedata-key' -a optionsengines"
Write-Host "fly secrets set MARKET_DATA_API_KEY='your-marketdata-key' -a optionsengines"
Write-Host ""
Write-Host "Or set them all at once (replace the placeholder values first):" -ForegroundColor Yellow
Write-Host ""
Write-Host "fly secrets set ``"
Write-Host "  DATABASE_URL='your-neon-connection-string' ``"
Write-Host "  JWT_SECRET='$JWT_SECRET' ``"
Write-Host "  HMAC_SECRET='$HMAC_SECRET' ``"
Write-Host "  ALPACA_API_KEY='your-alpaca-key' ``"
Write-Host "  ALPACA_SECRET_KEY='your-alpaca-secret' ``"
Write-Host "  TWELVE_DATA_API_KEY='your-twelvedata-key' ``"
Write-Host "  MARKET_DATA_API_KEY='your-marketdata-key' ``"
Write-Host "  -a optionsengines"
