# Deployment Guide

## Architecture Overview

- **Backend API**: Fly.io (Node.js/Express with static IP)
- **Database**: Neon PostgreSQL
- **Frontend**: Vercel (React/Vite)

## Prerequisites

1. Install Fly.io CLI: https://fly.io/docs/hands-on/install-flyctl/
2. Install Vercel CLI: `npm i -g vercel`
3. GitHub repository: https://github.com/HaloHealthAfrica/optionsengines

## Backend Deployment (Fly.io)

### 1. Login to Fly.io

```bash
fly auth login
```

### 2. Create/Update Fly.io App

If this is your first deployment:

```bash
fly launch --no-deploy
```

This will use the existing `fly.toml` configuration.

### 3. Set Environment Secrets

Set all required environment variables as secrets:

```bash
# Database
fly secrets set DATABASE_URL="postgresql://neondb_owner:npg_uCpWnrt3Pei8@ep-withered-mud-ah66kagz-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require"

# Authentication
fly secrets set JWT_SECRET="your-jwt-secret-here"
fly secrets set HMAC_SECRET="your-hmac-secret-here"

# Alpaca API
fly secrets set ALPACA_API_KEY="your-alpaca-key"
fly secrets set ALPACA_SECRET_KEY="your-alpaca-secret"
fly secrets set ALPACA_PAPER="true"
fly secrets set ALPACA_BASE_URL="https://paper-api.alpaca.markets"

# TwelveData API
fly secrets set TWELVE_DATA_API_KEY="your-twelvedata-key"

# MarketData.app
fly secrets set MARKET_DATA_API_KEY="your-marketdata-key"

# Optional: Polygon
fly secrets set POLYGON_API_KEY="your-polygon-key"
```

### 4. Deploy to Fly.io

```bash
fly deploy
```

### 5. Run Database Migrations

After deployment, run migrations:

```bash
fly ssh console
cd /app
node dist/migrations/runner.js up
exit
```

### 6. Get Your Backend URL and IP

```bash
# Get app URL
fly status

# Get static IP addresses
fly ips list
```

Your backend will be available at: `https://dual-engine-options-trading.fly.dev`

## Frontend Deployment (Vercel)

### 1. Update Frontend API Client

Update `frontend/src/services/apiClient.ts` with your Fly.io backend URL:

```typescript
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://dual-engine-options-trading.fly.dev';
```

### 2. Create Vercel Project

```bash
cd frontend
vercel
```

Follow the prompts:
- Link to existing project or create new
- Set build command: `npm run build`
- Set output directory: `dist`

### 3. Set Environment Variables in Vercel

In Vercel dashboard or via CLI:

```bash
vercel env add VITE_API_URL
# Enter: https://dual-engine-options-trading.fly.dev
```

### 4. Deploy

```bash
vercel --prod
```

## CORS Configuration

Update `src/app.ts` to allow your Vercel frontend:

```typescript
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://your-app.vercel.app'
  ],
  credentials: true
}));
```

Then redeploy to Fly.io:

```bash
fly deploy
```

## Monitoring & Logs

### Fly.io Logs

```bash
fly logs
```

### Fly.io Metrics

```bash
fly dashboard
```

### Database Connection

```bash
psql 'postgresql://neondb_owner:npg_uCpWnrt3Pei8@ep-withered-mud-ah66kagz-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require'
```

## Scaling

### Scale Fly.io

```bash
# Scale to 2 machines
fly scale count 2

# Scale memory
fly scale memory 1024

# Scale CPU
fly scale vm shared-cpu-2x
```

## Health Checks

- Backend health: `https://dual-engine-options-trading.fly.dev/health`
- API endpoints:
  - `POST /api/entry-decision`
  - `POST /api/strike-selection`
  - `POST /api/exit-decision`

## Troubleshooting

### Check Fly.io Status

```bash
fly status
fly checks list
```

### SSH into Fly.io Machine

```bash
fly ssh console
```

### View Environment Variables

```bash
fly secrets list
```

### Restart App

```bash
fly apps restart dual-engine-options-trading
```

## CI/CD with GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Fly.io

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Add `FLY_API_TOKEN` to GitHub secrets:

```bash
fly tokens create deploy
# Copy token and add to GitHub repository secrets
```

## Cost Estimates

- **Fly.io**: ~$5-10/month (1 shared CPU, 512MB RAM)
- **Neon**: Free tier (0.5GB storage, 100 hours compute)
- **Vercel**: Free tier (100GB bandwidth)

## Support

- Fly.io: https://fly.io/docs
- Neon: https://neon.tech/docs
- Vercel: https://vercel.com/docs
