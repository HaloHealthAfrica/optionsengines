import { db } from '../src/services/database.service.js';

const r = await db.query(`
  SELECT signal_id, symbol, direction, timeframe, status, rejection_reason, created_at
  FROM signals
  WHERE status = 'rejected'
  ORDER BY created_at DESC
  LIMIT 15
`);
console.table(r.rows);
process.exit(0);
