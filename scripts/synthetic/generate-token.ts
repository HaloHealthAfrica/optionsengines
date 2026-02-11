import 'dotenv/config';
import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET ?? '';
if (!secret || secret.length < 32) {
  throw new Error('JWT_SECRET is missing or too short to generate token.');
}

const payload = {
  userId: 'synthetic-admin',
  email: 'synthetic-admin@example.test',
  role: 'admin',
};

const token = jwt.sign(payload, secret, {
  expiresIn: '24h',
  issuer: 'dual-engine-trading-platform',
  audience: 'trading-platform-users',
});

// eslint-disable-next-line no-console
console.log(token);
