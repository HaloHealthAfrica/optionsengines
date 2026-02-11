# Vercel Deployment Instructions

## Project Structure
This is a monorepo with:
- **Backend**: Node.js/Express API (root directory)
- **Frontend**: Next.js 14 application (`frontend/` directory)

## Deploying the Frontend to Vercel

### Step 1: Configure Root Directory
In your Vercel project settings:
1. Go to **Settings** → **General**
2. Set **Root Directory** to: `frontend`
3. Framework Preset should auto-detect as **Next.js**

### Step 2: Set Environment Variables
In **Settings** → **Environment Variables**, add:

| Variable | Value | Environment |
|----------|-------|-------------|
| `JWT_SECRET` | A strong random string (min 32 chars) | Production, Preview, Development |
| `DEMO_EMAIL` | `demo@optionagents.ai` | Production, Preview, Development |
| `DEMO_PASSWORD` | `demo` (or your preferred password) | Production, Preview, Development |
| `NODE_ENV` | `production` | Production |

**Important**: Make sure to select all three environments (Production, Preview, Development) when adding each variable.

### Step 3: Generate a Strong JWT_SECRET
Use one of these methods:

**Option 1 - Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Option 2 - OpenSSL:**
```bash
openssl rand -hex 32
```

**Option 3 - Online:**
Use a password generator to create a 64+ character random string.

### Step 4: Redeploy
After setting environment variables:
1. Go to **Deployments** tab
2. Click the three dots on the latest deployment
3. Select **Redeploy**
4. Check "Use existing Build Cache" is OFF

## Testing the Deployment

Once deployed, visit your Vercel URL and try logging in with:
- **Email**: The value you set for `DEMO_EMAIL`
- **Password**: The value you set for `DEMO_PASSWORD`

## Troubleshooting

### "JWT_SECRET is not set" Error
- Verify the environment variables are set in Vercel dashboard
- Make sure you selected all environments when adding variables
- Redeploy after adding variables (don't use cached build)
- Check the deployment logs for any errors

### "Invalid credentials" Error
- Verify `DEMO_EMAIL` and `DEMO_PASSWORD` match what you're entering
- Check for typos in the environment variable names
- Environment variables are case-sensitive

### Build Fails
- Ensure Root Directory is set to `frontend`
- Check that all dependencies are in `frontend/package.json`
- Review build logs in Vercel dashboard

## Local Development

For local development, create `frontend/.env.local`:
```bash
JWT_SECRET=your-secret-key-min-32-chars-change-in-production
DEMO_EMAIL=demo@optionagents.ai
DEMO_PASSWORD=demo
NODE_ENV=development
```

Then run:
```bash
cd frontend
npm install
npm run dev
```
