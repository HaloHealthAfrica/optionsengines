# Data Source Unavailable — Troubleshooting Guide

When the dashboard shows **"Data source unavailable. Showing last known data."** or **"Data source: unknown"**, the frontend cannot reach the backend or the backend is returning errors. This guide helps you fix it.

## Try This First

If you already set `NEXT_PUBLIC_API_URL` and redeployed:

1. **Log out, then log in again** — If you logged in when the backend was unreachable, you have a "local" token that won't work with the backend. Logging out and back in gets a fresh backend token.
2. **Run the diagnostic** — `node scripts/diagnose-data-source.js` (from project root) to see exactly what fails.

## How It Works

1. **Frontend** (Vercel: `optionsengines.vercel.app`) → calls `/api/dashboard/metrics`
2. **Next.js API route** → proxies to backend at `NEXT_PUBLIC_API_URL` or `API_URL` (e.g. `https://optionsengines.fly.dev`)
3. **Backend** (Fly.io) → `/dashboard` endpoint queries the database (Neon PostgreSQL)
4. If the backend succeeds → `x-data-source: backend` → no banner
5. If the backend fails (unreachable, timeout, 5xx, 401) → fallback to mock data with `x-data-source: mock` → banner appears

## Fix Checklist

### 1. Vercel: Set `NEXT_PUBLIC_API_URL`

The frontend API routes need to know where the backend lives.

1. Go to [Vercel Dashboard](https://vercel.com) → Your project → **Settings** → **Environment Variables**
2. Add or update:
   - **Key**: `NEXT_PUBLIC_API_URL`
   - **Value**: `https://optionsengines.fly.dev` (your Fly.io backend URL)
   - **Environments**: Production, Preview, Development
3. **Redeploy** the frontend (Deployments → ⋮ → Redeploy)

**Verify**: After redeploy, the serverless functions will use this URL when calling the backend.

---

### 2. Backend Running on Fly.io

Ensure the backend is deployed and healthy.

```bash
# Check status
fly status -a optionsengines

# If needed, deploy
fly deploy -a optionsengines

# Check health
curl https://optionsengines.fly.dev/health
```

Expected health response: `{"status":"healthy", ...}`

---

### 3. Database Connection (DATABASE_URL)

The backend needs a valid Neon PostgreSQL connection string.

```bash
# List secrets (value is hidden)
fly secrets list -a optionsengines

# If DATABASE_URL is missing, set it
fly secrets set DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" -a optionsengines

# Restart app to pick up new secrets
fly apps restart optionsengines
```

**Verify DB from backend**:

```bash
fly ssh console -a optionsengines
node -e "require('./dist/services/database.service.js').db.query('SELECT 1').then(() => console.log('DB OK')).catch(e => console.error('DB FAIL:', e.message))"
exit
```

---

### 4. Authentication

The dashboard requires a valid JWT. If you're not logged in or the token is expired:

1. Log in at `https://optionsengines.vercel.app` (or your frontend URL)
2. If login fails, see [LOGIN_TROUBLESHOOTING.md](../LOGIN_TROUBLESHOOTING.md)
3. Ensure `JWT_SECRET` is set on Fly.io (required for token verification)

```bash
fly secrets set JWT_SECRET="your-secret-min-32-chars" -a optionsengines
fly apps restart optionsengines
```

---

### 5. Run Connectivity Test

From the project root:

```bash
node scripts/test-production-connectivity.js
```

This tests:
- Backend root and `/health`
- Login (demo user)
- Authenticated `/flow/SPY`

If any step fails, the script suggests next steps.

---

## Quick Verification

| Check | Command / Action |
|-------|------------------|
| Backend reachable | `curl https://optionsengines.fly.dev/health` |
| Vercel env set | Vercel → Settings → Environment Variables → `NEXT_PUBLIC_API_URL` |
| DB connected | `fly ssh console -a optionsengines` then `node -e "require('./dist/services/database.service.js').db.query('SELECT 1')"` |
| Frontend redeployed | Vercel → Deployments → Redeploy (after env change) |

---

## Common Causes

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "Data source: unknown" | `NEXT_PUBLIC_API_URL` not set or wrong | Set in Vercel, redeploy |
| Backend timeout | Fly.io cold start or overload | Dashboard now uses 60s timeout; wait and retry |
| 401 Unauthorized | Not logged in or invalid token | **Log out, then log in again** (gets fresh backend token) |
| Old token | Logged in when backend was down | You have a "local" token; log out and log in again |
| 500 from backend | DB connection failed, missing env | Check `DATABASE_URL`, `fly logs` |
| CORS error | Frontend URL not in backend CORS | Add Vercel URL to `src/app.ts` CORS config |

---

## See Also

- [LOGIN_TROUBLESHOOTING.md](../LOGIN_TROUBLESHOOTING.md) — Auth and login issues
- [VERCEL_SETUP.md](../VERCEL_SETUP.md) — Frontend deployment
- [DEPLOYMENT.md](../DEPLOYMENT.md) — Full deployment guide
