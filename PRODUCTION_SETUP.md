# Production Setup Guide

## Current Issue
The frontend is trying to connect to the backend but failing because the backend URL is not configured in Vercel.

## Solution: Configure Vercel Environment Variables

### Step 1: Set Backend URL
In your Vercel project dashboard:

1. Go to **Settings** → **Environment Variables**
2. Add this variable for **Production**, **Preview**, and **Development**:

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_API_URL` | `https://optionsengines.fly.dev` | Your Fly.io backend URL |
| `JWT_SECRET` | (same as backend) | Must match backend's JWT_SECRET |

### Step 2: Verify Backend is Running
Check that your backend is deployed and running on Fly.io:

```bash
fly status -a optionsengines
```

If not running, deploy it:
```bash
fly deploy
```

### Step 3: Test Backend Endpoint
Verify the backend login endpoint works:

```bash
curl -X POST https://optionsengines.fly.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email","password":"your-password"}'
```

You should get a response with a token.

### Step 4: Redeploy Frontend
After setting environment variables in Vercel:

1. Go to **Deployments** tab
2. Click the three dots on latest deployment
3. Select **Redeploy**
4. **Uncheck** "Use existing Build Cache"

## Fallback Mode

The frontend now has a fallback mechanism:
- **Primary**: Tries to authenticate with backend
- **Fallback**: If backend is unavailable, uses local authentication with demo credentials

### Demo Credentials (Fallback Mode)
- Email: `demo@optionagents.ai`
- Password: `demo`

Set these in Vercel if you want to use fallback mode:
- `DEMO_EMAIL`
- `DEMO_PASSWORD`

## Architecture

```
User → Vercel (Frontend) → Fly.io (Backend) → PostgreSQL
```

The frontend proxies authentication and data requests to the backend API.

## Troubleshooting

### "Fetch failed" Error
- Backend is not running on Fly.io
- `NEXT_PUBLIC_API_URL` not set in Vercel
- CORS issues (backend needs to allow Vercel domain)

### "Invalid credentials" Error
- User doesn't exist in backend database
- Wrong password
- Backend database not seeded with users

### Backend Not Responding
Check backend logs:
```bash
fly logs -a optionsengines
```

### Create a User in Backend
You need to create a user in your backend database. Options:

1. **Use the register endpoint** (if enabled):
```bash
curl -X POST https://optionsengines.fly.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"yourpassword","role":"admin"}'
```

2. **Use the backend script**:
```bash
cd backend
npm run create-user
```

3. **Direct database insert**:
```sql
INSERT INTO users (email, password_hash, role) 
VALUES ('admin@example.com', '$2b$10$...', 'admin');
```

## Quick Fix: Use Fallback Mode

If you want the frontend to work immediately without the backend:

1. In Vercel, set:
   - `DEMO_EMAIL` = `demo@optionagents.ai`
   - `DEMO_PASSWORD` = `demo`
   - `JWT_SECRET` = (any 32+ char string)

2. Don't set `NEXT_PUBLIC_API_URL` (or set it to empty)

3. Redeploy

The frontend will use local authentication and mock data.
