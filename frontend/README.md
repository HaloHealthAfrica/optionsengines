# OptionAgents Frontend

Modern Next.js 14 frontend for the OptionAgents trading platform.

## Architecture

This frontend connects to the Express.js backend API for:
- User authentication
- Dashboard data
- Trading positions
- Order management

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local` file with your configuration:
```bash
# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:8080

# JWT Secret (must match backend)
JWT_SECRET=your-secret-key-min-32-chars-change-in-production

# Demo credentials (fallback)
DEMO_EMAIL=demo@optionagents.ai
DEMO_PASSWORD=demo

NODE_ENV=development
```

3. Start the backend server (in root directory):
```bash
npm run dev
```

4. Start the frontend (in frontend directory):
```bash
npm run dev
```

5. Open http://localhost:3000

## Backend Connection

The frontend proxies requests to the backend API:
- **Local**: `http://localhost:8080`
- **Production**: `https://optionsengines.fly.dev`

Set `NEXT_PUBLIC_API_URL` to your backend URL.

## Authentication Flow

1. User submits login form
2. Frontend sends credentials to backend `/api/auth/login`
3. Backend validates against database and returns JWT token
4. Frontend stores token in HttpOnly cookie
5. Subsequent requests include token for authorization

## Default Credentials

Create a user in the backend database or use the backend's demo credentials.

## Environment Variables

### Required
- `NEXT_PUBLIC_API_URL` - Backend API URL
- `JWT_SECRET` - Secret key for JWT token validation (must match backend)

### Optional
- `DEMO_EMAIL` - Fallback email for demo mode
- `DEMO_PASSWORD` - Fallback password for demo mode
- `NODE_ENV` - Environment mode (development/production)

## Deployment on Vercel

Set these environment variables in your Vercel project settings:

1. Go to Project Settings → Environment Variables
2. Add:
   - `NEXT_PUBLIC_API_URL` = `https://optionsengines.fly.dev` (your backend URL)
   - `JWT_SECRET` (must match your backend's JWT_SECRET)
   - `DEMO_EMAIL` (optional fallback)
   - `DEMO_PASSWORD` (optional fallback)

## Features

- JWT-based authentication with backend
- Real-time dashboard data from backend API
- Fallback to mock data if backend is unavailable
- Server-side rendering with Next.js 14
- Edge runtime support for auth routes

