# Vercel Frontend Deployment Setup

## Configuration Settings

### Project Settings
- **Project Name**: `optionsengines` (or your preferred name)
- **Framework Preset**: Next.js
- **Root Directory**: `frontend` ⚠️ IMPORTANT - must point to frontend folder
- **Node.js Version**: 20.x (default)

### Build Settings
- **Build Command**: `npm run build` (auto-detected)
- **Output Directory**: `dist` (auto-detected)
- **Install Command**: `npm install` (auto-detected)

### Environment Variables

Add these in Vercel Dashboard → Settings → Environment Variables:

| Key | Value | Environments |
|-----|-------|--------------|
| `NEXT_PUBLIC_API_URL` | `https://optionsengines.fly.dev` | Production, Preview, Development |

**Note**: Replace `optionsengines.fly.dev` with your actual Fly.io app URL.

## Deployment Methods

### Method 1: Vercel Dashboard (Recommended for first deploy)
1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Set Root Directory to `frontend`
4. Add environment variable `NEXT_PUBLIC_API_URL`
5. Click Deploy

### Method 2: Vercel CLI
```bash
cd frontend
npm install -g vercel
vercel login
vercel
```

Follow prompts and set:
- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`

Then set environment variable:
```bash
vercel env add NEXT_PUBLIC_API_URL production
# Enter: https://optionsengines.fly.dev
```

Deploy to production:
```bash
vercel --prod
```

## After Deployment

### 1. Get your Vercel URL
After deployment, you'll get a URL like: `https://optionsengines.vercel.app`

### 2. Update CORS on Backend
Update your backend's CORS configuration to allow your Vercel domain.

In `src/app.ts`, add your Vercel URL to allowed origins:
```typescript
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://optionsengines.vercel.app',  // Add your Vercel URL
    'https://optionsengines-*.vercel.app' // Allow preview deployments
  ],
  credentials: true
}));
```

Then redeploy backend:
```bash
fly deploy -a optionsengines
```

### 3. Test the Connection
Visit your Vercel URL and check:
- Frontend loads correctly
- API calls work (check browser console for errors)
- No CORS errors

## Troubleshooting

### Issue: 404 on page refresh
**Solution**: Already configured in `vercel.json` with rewrites

### Issue: API calls fail with CORS error
**Solution**: Add Vercel URL to backend CORS configuration (see step 2 above)

### Issue: Environment variable not working
**Solution**: 
- Verify variable name is `NEXT_PUBLIC_API_URL` (Next.js exposes `NEXT_PUBLIC_*` to the browser)
- Redeploy after adding environment variables
- Check in browser console: `process.env.NEXT_PUBLIC_API_URL`

### Issue: Build fails
**Solution**: 
- Ensure Root Directory is set to `frontend`
- Check build logs for TypeScript errors
- Verify all dependencies are in `package.json`

## Custom Domain (Optional)

1. Go to Vercel Dashboard → Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed
4. Update backend CORS with new domain

## Continuous Deployment

Vercel automatically deploys:
- **Production**: When you push to `main` branch
- **Preview**: When you create a pull request

To disable auto-deployment:
- Go to Settings → Git → Ignored Build Step
- Add custom logic if needed

## Monitoring

- **Deployments**: https://vercel.com/dashboard
- **Analytics**: Enable in Vercel Dashboard → Analytics
- **Logs**: View in Deployment details

## Cost

- **Hobby Plan**: Free
  - 100GB bandwidth/month
  - Unlimited deployments
  - Automatic HTTPS
  
- **Pro Plan**: $20/month
  - 1TB bandwidth
  - Advanced analytics
  - Team collaboration
