# Login Troubleshooting Guide

## Common Issues and Solutions

### Issue 1: NEXT_PUBLIC_API_URL Not Set in Vercel

**Symptom**: Login page shows "Cannot connect to server" or "Failed to fetch"

**Solution**:
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add environment variable:
   - **Key**: `NEXT_PUBLIC_API_URL`
   - **Value**: `https://optionsengines.fly.dev` (replace with your actual Fly.io URL)
   - **Environments**: Check all (Production, Preview, Development)
3. Redeploy the frontend (Vercel → Deployments → Redeploy)

**Verify**:
- Look at the bottom of the login page - it should show your Fly.io URL, not `http://localhost:3000`
- Open browser console (F12) and check the "Attempting to connect to:" log

---

### Issue 2: Auth Migration Not Applied

**Symptom**: Login fails with "Invalid credentials" even with correct password, or "User not found"

**Solution**:

#### Step 1: Check if migration was applied
```bash
fly ssh console -a optionsengines
psql $DATABASE_URL -c "SELECT table_name FROM information_schema.tables WHERE table_name = 'users';"
```

If it returns no rows, the migration hasn't been applied.

#### Step 2: Run the migration
```bash
# Still in the SSH console
node dist/migrations/runner.js up
exit
```

#### Step 3: Verify the default admin user exists
```bash
fly ssh console -a optionsengines
psql $DATABASE_URL -c "SELECT email, role, created_at FROM users WHERE email = 'admin@optionagents.com';"
exit
```

You should see:
```
           email            | role  |         created_at
----------------------------+-------+----------------------------
 admin@optionagents.com     | admin | 2024-02-04 01:00:00.000000
```

---

### Issue 3: CORS Error

**Symptom**: Browser console shows "CORS policy" error

**Solution**:
The backend CORS is already configured for Vercel. If you see CORS errors:

1. Verify your Vercel URL is in the CORS whitelist in `src/app.ts`:
   ```typescript
   origin: [
     'http://localhost:5173',
     'http://localhost:3000',
     'https://optionsengines.vercel.app',
     /^https:\/\/optionsengines-.*\.vercel\.app$/,
   ]
   ```

2. If your Vercel URL is different, update the CORS config and redeploy backend:
   ```bash
   fly deploy -a optionsengines
   ```

---

### Issue 4: Backend Not Deployed

**Symptom**: "Cannot connect to server" or 404 errors

**Solution**:
```bash
# Check if backend is running
fly status -a optionsengines

# If not running or needs update, deploy
fly deploy -a optionsengines

# Check logs
fly logs -a optionsengines
```

**Verify**:
Visit `https://optionsengines.fly.dev/health` - should return:
```json
{
  "status": "healthy",
  "uptime_seconds": 123,
  "database": { "ok": true }
}
```

---

### Issue 5: Environment Secrets Not Set

**Symptom**: Backend crashes on startup with "Missing required environment variable"

**Solution**:
```bash
# Check which secrets are set
fly secrets list -a optionsengines

# Set missing secrets
fly secrets set DATABASE_URL="your-neon-connection-string" -a optionsengines
fly secrets set JWT_SECRET="your-jwt-secret-min-32-chars" -a optionsengines
fly secrets set HMAC_SECRET="your-hmac-secret" -a optionsengines
```

See `set-fly-secrets.ps1` for the complete list of required secrets.

---

## Quick Verification Checklist

Run through this checklist to verify everything is set up correctly:

### Backend (Fly.io)
- [ ] Backend is deployed: `fly status -a optionsengines`
- [ ] Backend is healthy: Visit `https://optionsengines.fly.dev/health`
- [ ] Database is connected: Health endpoint shows `"database": { "ok": true }`
- [ ] Migrations are applied: `users` table exists
- [ ] Default admin user exists: Query shows admin@optionagents.com
- [ ] Environment secrets are set: `fly secrets list -a optionsengines`

### Frontend (Vercel)
- [ ] Frontend is deployed: Check Vercel dashboard
- [ ] `NEXT_PUBLIC_API_URL` is set: Check Vercel → Settings → Environment Variables
- [ ] API URL is correct: Check bottom of login page
- [ ] CORS is configured: Backend allows your Vercel domain

### Test Login
- [ ] Can create new account (sign up works)
- [ ] Can login with new account
- [ ] Can login with default admin (admin@optionagents.com / admin123)
- [ ] Token is saved (check localStorage in browser DevTools)
- [ ] Redirects to dashboard after login

---

## Manual Testing Commands

### Test Backend Directly
```bash
# Test health endpoint
curl https://optionsengines.fly.dev/health

# Test registration
curl -X POST https://optionsengines.fly.dev/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Test login
curl -X POST https://optionsengines.fly.dev/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@optionagents.com","password":"admin123"}'
```

### Check Database Directly
```bash
fly ssh console -a optionsengines

# List all users
psql $DATABASE_URL -c "SELECT user_id, email, role, created_at, is_active FROM users;"

# Check specific user
psql $DATABASE_URL -c "SELECT * FROM users WHERE email = 'admin@optionagents.com';"

# Count users
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"

exit
```

---

## Still Having Issues?

### Check Browser Console
1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for errors (red text)
4. Check Network tab for failed requests

### Check Backend Logs
```bash
fly logs -a optionsengines
```

Look for:
- Database connection errors
- Authentication errors
- Missing environment variables
- CORS errors

### Common Error Messages

**"Missing required environment variable: JWT_SECRET"**
→ Set JWT_SECRET in Fly.io secrets

**"Cannot connect to server"**
→ Backend not deployed or NEXT_PUBLIC_API_URL not set

**"Invalid credentials"**
→ Wrong password or user doesn't exist (check migration)

**"User already exists"**
→ Try logging in instead of signing up

**"CORS policy"**
→ Add your Vercel URL to backend CORS config

---

## Reset Everything (Nuclear Option)

If nothing works, start fresh:

```bash
# 1. Redeploy backend
fly deploy -a optionsengines

# 2. Reset database (WARNING: deletes all data)
fly ssh console -a optionsengines
psql $DATABASE_URL -c "DROP TABLE IF EXISTS users CASCADE;"
node dist/migrations/runner.js up
exit

# 3. Verify default admin exists
fly ssh console -a optionsengines
psql $DATABASE_URL -c "SELECT * FROM users WHERE email = 'admin@optionagents.com';"
exit

# 4. Test login with default admin
# Visit your Vercel URL and login with:
# Email: admin@optionagents.com
# Password: admin123
```
