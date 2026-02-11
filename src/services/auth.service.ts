// Authentication Service: JWT token generation and validation
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface TokenPayload {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
}

interface TokenResult {
  token: string;
  expiresIn: string;
  expiresAt: Date;
}

export class AuthService {
  private readonly jwtSecret: string;
  private readonly tokenExpiration: string = '24h';
  private readonly saltRounds: number = 10;

  constructor() {
    this.jwtSecret = config.jwtSecret;
    if (!this.jwtSecret || this.jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters');
    }
  }

  async hashPassword(password: string): Promise<string> {
    try {
      const hash = await bcrypt.hash(password, this.saltRounds);
      logger.debug('Password hashed successfully');
      return hash;
    } catch (error) {
      logger.error('Password hashing failed', error);
      throw new Error('Failed to hash password');
    }
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      const isValid = await bcrypt.compare(password, hash);
      logger.debug('Password verification', { isValid });
      return isValid;
    } catch (error) {
      logger.error('Password verification failed', error);
      return false;
    }
  }

  generateToken(payload: TokenPayload): TokenResult {
    try {
      const token = jwt.sign(payload, this.jwtSecret, {
        expiresIn: this.tokenExpiration,
        issuer: 'dual-engine-trading-platform',
        audience: 'trading-platform-users',
      } as jwt.SignOptions);

      const decoded = jwt.decode(token) as any;
      const expiresAt = new Date(decoded.exp * 1000);

      logger.info('JWT token generated', {
        userId: payload.userId,
        role: payload.role,
        expiresAt,
      });

      return {
        token,
        expiresIn: this.tokenExpiration,
        expiresAt,
      };
    } catch (error) {
      logger.error('Token generation failed', error);
      throw new Error('Failed to generate token');
    }
  }

  verifyToken(token: string): TokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'dual-engine-trading-platform',
        audience: 'trading-platform-users',
      }) as TokenPayload;

      logger.debug('Token verified successfully', {
        userId: decoded.userId,
        role: decoded.role,
      });

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        logger.warn('Token expired', { expiredAt: error.expiredAt });
      } else if (error instanceof jwt.JsonWebTokenError) {
        logger.warn('Invalid token', { message: error.message });
      } else {
        logger.error('Token verification failed', error);
      }
      return null;
    }
  }

  decodeToken(token: string): TokenPayload | null {
    try {
      const decoded = jwt.decode(token) as TokenPayload;
      return decoded;
    } catch (error) {
      logger.error('Token decoding failed', error);
      return null;
    }
  }

  refreshToken(oldToken: string): TokenResult | null {
    const payload = this.verifyToken(oldToken);
    if (!payload) {
      logger.warn('Cannot refresh invalid token');
      return null;
    }

    // Generate new token with same payload
    return this.generateToken(payload);
  }

  hasRole(token: string, requiredRole: 'admin' | 'researcher' | 'user'): boolean {
    const payload = this.verifyToken(token);
    if (!payload) {
      return false;
    }

    const roleHierarchy: Record<string, number> = {
      user: 1,
      researcher: 2,
      admin: 3,
    };

    const userRoleLevel = roleHierarchy[payload.role] || 0;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

    return userRoleLevel >= requiredRoleLevel;
  }

  extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      logger.warn('Invalid authorization header format');
      return null;
    }

    return parts[1];
  }

  generateHmacSignature(payload: string): string {
    if (!config.hmacSecret) {
      throw new Error('HMAC_SECRET is not configured');
    }

    const hmac = crypto.createHmac('sha256', config.hmacSecret);
    hmac.update(payload);
    return hmac.digest('hex');
  }

  verifyHmacSignature(payload: string, signature: string): boolean {
    if (!config.hmacSecret) {
      return false;
    }

    const expectedSignature = this.generateHmacSignature(payload);
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const signatureBuffer = Buffer.from(signature, 'hex');

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  }
}

// Singleton instance
export const authService = new AuthService();
