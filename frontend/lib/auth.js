import { SignJWT, jwtVerify } from 'jose';

const encoder = new TextEncoder();

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET environment variable is not set!');
    console.error('Available env vars:', Object.keys(process.env).filter(k => !k.includes('SECRET')));
    throw new Error('JWT_SECRET is not set. Please configure it in your environment variables.');
  }
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
  return encoder.encode(secret);
}

export async function signToken(payload) {
  const secret = getJwtSecret();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1d')
    .setIssuer('optionagents')
    .setAudience('optionagents-users')
    .sign(secret);
}

export async function verifyToken(token) {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'optionagents',
      audience: 'optionagents-users',
    });
    return payload;
  } catch (error) {
    return null;
  }
}

export function validateCredentials(email, password) {
  const allowedEmail = process.env.DEMO_EMAIL || 'demo@optionagents.ai';
  const allowedPassword = process.env.DEMO_PASSWORD || 'demo';
  console.log('Validating credentials against:', { allowedEmail, passwordSet: !!allowedPassword });
  return email === allowedEmail && password === allowedPassword;
}
