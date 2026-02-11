# Authentication Setup Guide

## Overview

The app now has full database-backed authentication with:
- User registration (sign up)
- User login
- JWT token-based authentication
- Password hashing with bcrypt
- Database storage of users

## Database Migration

After deploying the backend, run the new migration to create the users table:

```bash
# SSH into Fly.io
fly ssh console -a optionsengines

# Run migrations
node dist/migrations/runner.js up

# Exit
exit
```

This will create:
- `users` table with columns: user_id, email, password_hash, role, created_at, updated_at, last_login_at, is_active
- Default admin user with credentials below

## Default Admin Account

**Email**: `admin@optionagents.com`  
**Password**: `admin123`

⚠️ **IMPORTANT**: Change this password after first login in production!

## Frontend Features

### Login Page
- Email/password login form
- "Sign Up" toggle to switch to registration
- "Use Demo Token" button for quick access
- Shows default credentials

### Registration
- Users can create new accounts
- Email validation
- Password strength validation (min 6 characters)
- Password confirmation
- Automatic login after registration

### Protected Routes
- All dashboard pages require authentication
- Automatic redirect to login if no token
- Token stored in localStorage

### Logout
- Logout button in header (TokenBar)
- Clears token and redirects to login

## API Endpoints

### POST /auth/register
Create a new user account.

**Request**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "role": "user"  // optional, defaults to "user"
}
```

**Response**:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2024-02-05T01:30:00.000Z",
  "user": {
    "user_id": "uuid",
    "email": "user@example.com",
    "role": "user",
    "created_at": "2024-02-04T01:30:00.000Z",
    "last_login_at": null
  }
}
```

### POST /auth/login
Login with existing credentials.

**Request**:
```json
{
  "email": "admin@optionagents.com",
  "password": "admin123"
}
```

**Response**:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2024-02-05T01:30:00.000Z",
  "user": {
    "user_id": "uuid",
    "email": "admin@optionagents.com",
    "role": "admin",
    "created_at": "2024-02-04T01:00:00.000Z",
    "last_login_at": "2024-02-04T01:30:00.000Z"
  }
}
```

### POST /auth/logout
Logout (logs the event, token cleared client-side).

**Headers**:
```
Authorization: Bearer <token>
```

**Response**:
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### GET /auth/me
Get current user information.

**Headers**:
```
Authorization: Bearer <token>
```

**Response**:
```json
{
  "success": true,
  "user": {
    "user_id": "uuid",
    "email": "admin@optionagents.com",
    "role": "admin",
    "created_at": "2024-02-04T01:00:00.000Z",
    "last_login_at": "2024-02-04T01:30:00.000Z"
  }
}
```

### POST /auth/generate-token
Generate a demo token (for development/testing).

**Request**:
```json
{
  "userId": "demo-user",
  "email": "demo@example.com",
  "role": "admin"
}
```

**Response**:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2024-02-05T01:30:00.000Z"
}
```

## Security Features

### Password Hashing
- Passwords hashed with bcrypt
- Salt rounds: 10
- Never stored in plain text

### JWT Tokens
- Signed with JWT_SECRET from environment
- Include user_id, email, and role
- Expire after configured time (default: 24 hours)

### Validation
- Email format validation
- Password strength requirements (min 6 characters)
- Duplicate email prevention
- SQL injection protection (parameterized queries)

## User Management

### User Service Methods

The `userService` provides these methods:

- `createUser(input)` - Create new user
- `findByEmail(email)` - Find user by email
- `findById(userId)` - Find user by ID
- `verifyPassword(email, password)` - Verify credentials
- `updateLastLogin(userId)` - Update last login timestamp
- `updatePassword(userId, newPassword)` - Change password
- `deactivateUser(userId)` - Soft delete user
- `listUsers()` - Get all active users
- `toPublic(user)` - Convert to public user object (no password hash)

## Testing

### Test Registration
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

### Test Login
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@optionagents.com","password":"admin123"}'
```

### Test Protected Endpoint
```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <your-token>"
```

## Production Checklist

- [ ] Change default admin password
- [ ] Set strong JWT_SECRET in environment
- [ ] Enable HTTPS only
- [ ] Add rate limiting to auth endpoints
- [ ] Add email verification (optional)
- [ ] Add password reset functionality (optional)
- [ ] Add 2FA (optional)
- [ ] Monitor failed login attempts
- [ ] Set up user activity logging
- [ ] Configure token expiration appropriately

## Troubleshooting

### "User already exists" error
- Email is already registered
- Try logging in instead
- Or use a different email

### "Invalid credentials" error
- Check email and password are correct
- Passwords are case-sensitive
- Try the default admin credentials

### "Failed to connect to database" error
- Ensure DATABASE_URL is set in Fly.io secrets
- Run migrations: `node dist/migrations/runner.js up`
- Check database connection

### Token expired
- Login again to get a new token
- Tokens expire after 24 hours by default

## Future Enhancements

Potential additions:
- Email verification
- Password reset via email
- Two-factor authentication (2FA)
- OAuth integration (Google, GitHub, etc.)
- User profile management
- Role-based access control (RBAC)
- Session management
- Account lockout after failed attempts
