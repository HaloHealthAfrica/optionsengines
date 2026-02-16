import { db } from '../src/services/database.service.js';
import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/run-migration.ts <migration-file>');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

(async () => {
  for (const stmt of statements) {
    try {
      await db.query(stmt);
      console.log('OK:', stmt.substring(0, 80) + (stmt.length > 80 ? '...' : ''));
    } catch (err: any) {
      console.log('WARN:', err.message?.substring(0, 100));
    }
  }
  console.log('Migration complete');
  process.exit(0);
})();
