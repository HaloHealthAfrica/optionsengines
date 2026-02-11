import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const ROLE = process.env.ADMIN_ROLE || 'admin';

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable.');
  process.exit(1);
}

if (!EMAIL || !PASSWORD) {
  console.error('Missing ADMIN_EMAIL or ADMIN_PASSWORD environment variables.');
  process.exit(1);
}

async function ensureAdminUser() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const existing = await pool.query(
      'SELECT user_id, email, role, is_active FROM users WHERE email = $1 LIMIT 1',
      [EMAIL]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      await pool.query(
        'UPDATE users SET role = $1, is_active = TRUE, updated_at = NOW() WHERE user_id = $2',
        [ROLE, user.user_id]
      );
      console.log(`✅ Updated user ${user.email} to role: ${ROLE}`);
      return;
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const created = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING user_id, email, role`,
      [EMAIL, passwordHash, ROLE]
    );

    console.log(`✅ Created ${ROLE} user: ${created.rows[0].email}`);
  } catch (error) {
    console.error('❌ Failed to create admin user:', error.message || error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

ensureAdminUser();
