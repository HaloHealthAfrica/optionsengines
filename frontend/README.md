# OptionAgents Frontend

Modern Next.js 14 frontend for the OptionAgents trading platform.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local` file with your credentials:
```bash
JWT_SECRET=your-secret-key-min-32-chars-change-in-production
DEMO_EMAIL=demo@optionagents.ai
DEMO_PASSWORD=demo
NODE_ENV=development
```

3. Run development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
npm start
```

## Default Credentials

- **Email**: `demo@optionagents.ai`
- **Password**: `demo`

You can change these in your `.env.local` file.

## Environment Variables

### Required
- `JWT_SECRET` - Secret key for JWT token signing (min 32 characters)
- `DEMO_EMAIL` - Email for demo login
- `DEMO_PASSWORD` - Password for demo login

### Optional
- `NODE_ENV` - Environment mode (development/production)

## Deployment on Vercel

Set these environment variables in your Vercel project settings:

1. Go to Project Settings → Environment Variables
2. Add:
   - `JWT_SECRET` (use a strong random string, min 32 chars)
   - `DEMO_EMAIL` (your login email)
   - `DEMO_PASSWORD` (your login password)

## Architecture

This is a standalone Next.js frontend with:
- Built-in authentication (JWT)
- API routes for auth and data
- Server-side rendering
- Edge runtime support

The frontend does NOT connect to the backend by default. It's a self-contained application.
