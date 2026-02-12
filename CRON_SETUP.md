# Vercel Cron + DB Locking Setup

Process pending signals when workers don't run (e.g. serverless). Uses DB locking (`processing_lock`, `FOR UPDATE SKIP LOCKED`) to avoid duplicate work across concurrent cron runs.

## How It Works

1. **Vercel Cron** runs every 2 minutes, hits `/api/cron/process-queue`
2. **Frontend proxy** (Next.js) forwards to backend with `CRON_SECRET`
3. **Backend** runs: orchestrator → order creator → paper executor → position refresher → exit monitor

## Environment Variables

### Frontend (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | Yes | Secret for cron auth (min 16 chars). Vercel adds it to requests. |
| `API_URL` / `NEXT_PUBLIC_API_URL` | Yes | Backend URL (e.g. `https://optionsengines.fly.dev`) |

### Backend (Fly.io or wherever)

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | Yes | Must match frontend. Used to verify cron requests. |
| `CRON_BATCH_SIZE` | No | Max signals per run (default: 10) |

## Setup Steps

1. **Create secret**
   ```bash
   openssl rand -hex 32
   ```

2. **Set in Vercel** (Settings → Environment Variables)
   - `CRON_SECRET` = your secret
   - `API_URL` = your backend URL

3. **Set in backend** (Fly.io secrets or .env)
   - `CRON_SECRET` = same value

4. **Deploy**
   - Frontend: redeploy to Vercel
   - Backend: redeploy so it picks up the new route

## Cron Schedule

- **Current:** Every 2 minutes (`*/2 * * * *`)
- **Change:** Edit `frontend/vercel.json` → `crons[0].schedule`

## Manual Test

```bash
curl -X POST "https://optionsengines.vercel.app/api/cron/process-queue" \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

## DB Locking

- `processing_lock` on `signals` prevents the same signal from being processed twice
- `FOR UPDATE SKIP LOCKED` lets overlapping cron runs grab different signals
- No Redis or external lock needed
