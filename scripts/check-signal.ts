import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  const signalId = process.argv[2] || 'c150270e-543b-4456-8ac9-a794b937db4f';

  console.log('=== SIGNAL STATE ===');
  const { rows: signals } = await pool.query(
    `SELECT signal_id, status, processed, processing_lock, rejection_reason, 
            experiment_id, queued_until, queue_reason, processing_attempts, 
            next_retry_at, meta_gamma, created_at
     FROM signals WHERE signal_id = $1`, [signalId]
  );
  console.log(JSON.stringify(signals[0], null, 2));

  const experimentId = signals[0]?.experiment_id;

  console.log('\n=== WEBHOOK EVENT ===');
  const { rows: events } = await pool.query(
    `SELECT event_id, status, processing_time_ms, error_message, variant
     FROM webhook_events WHERE signal_id = $1`, [signalId]
  );
  console.log(JSON.stringify(events[0] || 'NONE', null, 2));

  if (experimentId) {
    console.log('\n=== EXPERIMENT ===');
    const { rows: exps } = await pool.query(
      `SELECT * FROM experiments WHERE experiment_id = $1`, [experimentId]
    );
    console.log(JSON.stringify(exps[0] || 'NONE', null, 2));

    console.log('\n=== EXECUTION POLICY ===');
    const { rows: policies } = await pool.query(
      `SELECT * FROM execution_policies WHERE experiment_id = $1`, [experimentId]
    );
    console.log(JSON.stringify(policies[0] || 'NONE', null, 2));

    console.log('\n=== DECISION RECOMMENDATIONS ===');
    const { rows: recs } = await pool.query(
      `SELECT experiment_id, engine, symbol, direction, strike, expiration, 
              quantity, entry_price, is_shadow, timeframe
       FROM decision_recommendations WHERE experiment_id = $1`, [experimentId]
    );
    console.log(JSON.stringify(recs, null, 2));
  }

  console.log('\n=== ORDERS ===');
  const { rows: orders } = await pool.query(
    `SELECT order_id, symbol, option_symbol, strike, expiration, type, 
            quantity, order_type, status, engine, created_at
     FROM orders WHERE signal_id = $1`, [signalId]
  );
  console.log(JSON.stringify(orders, null, 2));

  console.log('\n=== TRADES ===');
  const { rows: trades } = await pool.query(
    `SELECT t.trade_id, t.fill_price, t.fill_quantity, t.fill_timestamp, t.engine, o.status as order_status
     FROM trades t JOIN orders o ON o.order_id = t.order_id 
     WHERE o.signal_id = $1`, [signalId]
  );
  console.log(JSON.stringify(trades, null, 2));

  console.log('\n=== POSITIONS ===');
  const { rows: positions } = await pool.query(
    `SELECT position_id, symbol, option_symbol, strike, type, quantity, 
            entry_price, current_price, unrealized_pnl, realized_pnl, status,
            entry_timestamp, exit_timestamp, engine, entry_bias_score, entry_regime_type
     FROM refactored_positions 
     WHERE experiment_id = $1 OR option_symbol IN (SELECT option_symbol FROM orders WHERE signal_id = $2)`,
    [experimentId || '00000000-0000-0000-0000-000000000000', signalId]
  );
  console.log(JSON.stringify(positions, null, 2));

  console.log('\n=== ENRICHED SIGNAL ===');
  const { rows: enriched } = await pool.query(
    `SELECT refactored_signal_id, rejection_reason FROM refactored_signals WHERE signal_id = $1`, [signalId]
  );
  console.log(JSON.stringify(enriched[0] || 'NONE', null, 2));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
