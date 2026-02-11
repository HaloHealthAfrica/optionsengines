// User service for database operations
import bcrypt from 'bcrypt';
import { db } from './database.service.js';
import { logger } from '../utils/logger.js';

export interface User {
  user_id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
  is_active: boolean;
}

export interface CreateUserInput {
  email: string;
  password: string;
  role?: string;
}

export interface UserPublic {
  user_id: string;
  email: string;
  role: string;
  created_at: Date;
  last_login_at: Date | null;
}

class UserService {
  private readonly SALT_ROUNDS = 10;

  async createUser(input: CreateUserInput): Promise<UserPublic> {
    const { email, password, role = 'user' } = input;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // Validate password strength
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Check if user already exists
    const existingUser = await this.findByEmail(email);
    if (existingUser) {
      throw new Error('User already exists');
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, this.SALT_ROUNDS);

    // Insert user
    const result = await db.query<User>(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING user_id, email, role, created_at, last_login_at`,
      [email, password_hash, role]
    );

    logger.info('User created', { email, role });

    return result.rows[0];
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await db.query<User>(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [email]
    );

    return result.rows[0] || null;
  }

  async findById(userId: string): Promise<User | null> {
    const result = await db.query<User>(
      'SELECT * FROM users WHERE user_id = $1 AND is_active = TRUE',
      [userId]
    );

    return result.rows[0] || null;
  }

  async verifyPassword(email: string, password: string): Promise<User | null> {
    const user = await this.findByEmail(email);
    if (!user) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return null;
    }

    // Update last login
    await this.updateLastLogin(user.user_id);

    return user;
  }

  async updateLastLogin(userId: string): Promise<void> {
    await db.query(
      'UPDATE users SET last_login_at = NOW() WHERE user_id = $1',
      [userId]
    );
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    const password_hash = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2',
      [password_hash, userId]
    );

    logger.info('Password updated', { userId });
  }

  async deactivateUser(userId: string): Promise<void> {
    await db.query(
      'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1',
      [userId]
    );

    logger.info('User deactivated', { userId });
  }

  async listUsers(): Promise<UserPublic[]> {
    const result = await db.query<UserPublic>(
      `SELECT user_id, email, role, created_at, last_login_at
       FROM users
       WHERE is_active = TRUE
       ORDER BY created_at DESC`
    );

    return result.rows;
  }

  toPublic(user: User): UserPublic {
    return {
      user_id: user.user_id,
      email: user.email,
      role: user.role,
      created_at: user.created_at,
      last_login_at: user.last_login_at,
    };
  }
}

export const userService = new UserService();
