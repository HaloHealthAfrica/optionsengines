import { db } from '../src/services/database.service.js';

async function run() {
  const stmts = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_refactored_signals_signal_id_unique ON refactored_signals(signal_id)',
    'ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE',
    'ALTER TABLE trades ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE',
    'ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE',
    "CREATE INDEX IF NOT EXISTS idx_orders_is_test ON orders(is_test) WHERE is_test = TRUE",
    "CREATE INDEX IF NOT EXISTS idx_positions_is_test ON refactored_positions(is_test) WHERE is_test = TRUE",
    'ALTER TABLE signals ADD COLUMN IF NOT EXISTS locked_by TEXT',
    'ALTER TABLE signals ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ',
    "CREATE INDEX IF NOT EXISTS idx_signals_locked_by ON signals(locked_by) WHERE locked_by IS NOT NULL",
  ];

  for (const s of stmts) {
    try {
      await db.query(s);
      console.log('OK:', s.slice(0, 80));
    } catch (e: any) {
      console.log('ERR:', s.slice(0, 80), '→', e.message);
    }
  }

  // Verify
  const checks = [
    { table: 'orders', col: 'is_test' },
    { table: 'signals', col: 'locked_by' },
    { table: 'refactored_positions', col: 'is_test' },
    { table: 'trades', col: 'is_test' },
  ];
  for (const { table, col } of checks) {
    const r = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, col]
    );
    console.log(`${table}.${col} exists: ${r.rows.length > 0}`);
  }

  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
