-- Create users table for authentication
CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Create index on role
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Insert default admin user (password: admin123)
-- Password hash generated with bcrypt, salt rounds = 10
INSERT INTO users (email, password_hash, role)
VALUES (
  'admin@optionagents.com',
  '$2b$10$4piScNGmRkJ/ivS1kOUgZOkK0nwXduNcAuIfE1gdfQiQVy4kMPZM.',
  'admin'
)
ON CONFLICT (email) DO NOTHING;
