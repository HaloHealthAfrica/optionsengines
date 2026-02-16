import { db } from '../src/services/database.service.js';

(async () => {
  try {
    await db.query(`
      ALTER TABLE refactored_positions
        ADD COLUMN IF NOT EXISTS high_water_mark DECIMAL(10,4),
        ADD COLUMN IF NOT EXISTS trailing_stop_price DECIMAL(10,4)
    `);
    console.log('OK: Added high_water_mark and trailing_stop_price to refactored_positions');

    await db.query(`
      ALTER TABLE exit_rules
        ADD COLUMN IF NOT EXISTS trailing_stop_percent DECIMAL(5,2) DEFAULT 15.00,
        ADD COLUMN IF NOT EXISTS trailing_stop_activation_percent DECIMAL(5,2) DEFAULT 20.00
    `);
    console.log('OK: Added trailing_stop columns to exit_rules');

    const result = await db.query(`
      UPDATE refactored_positions
      SET high_water_mark = GREATEST(entry_price, COALESCE(current_price, entry_price))
      WHERE status IN ('open', 'closing')
        AND high_water_mark IS NULL
    `);
    console.log('OK: Backfilled high_water_mark for', result.rowCount, 'positions');

    console.log('Migration complete');
  } catch (err: any) {
    console.error('Migration failed:', err.message);
  }
  process.exit(0);
})();
