/**
 * Webhook Diagnostic Script
 * 
 * Checks if webhooks are being received and processed
 */

import { db } from '../src/services/database.service.js';
import { logger } from '../src/utils/logger.js';

async function checkWebhooks() {
  console.log('🔍 Checking webhook activity...\n');

  try {
    // Check signals received today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const signalsToday = await db.query(
      `SELECT 
        COUNT(*) as total_signals,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        MIN(created_at) as first_signal,
        MAX(created_at) as last_signal
       FROM signals 
       WHERE created_at >= $1`,
      [todayStart]
    );

    const stats = signalsToday.rows[0];
    
    console.log('📊 Signals Today:');
    console.log(`   Total: ${stats.total_signals}`);
    console.log(`   Pending: ${stats.pending}`);
    console.log(`   Approved: ${stats.approved}`);
    console.log(`   Rejected: ${stats.rejected}`);
    console.log(`   First: ${stats.first_signal || 'None'}`);
    console.log(`   Last: ${stats.last_signal || 'None'}`);
    console.log('');

    if (stats.total_signals === '0') {
      console.log('⚠️  NO SIGNALS RECEIVED TODAY\n');
      console.log('Possible issues:');
      console.log('1. TradingView webhook not configured or not firing');
      console.log('2. Server not receiving requests (check server logs)');
      console.log('3. HMAC signature validation failing');
      console.log('4. Webhook endpoint URL incorrect');
      console.log('5. Server not running or crashed\n');
    }

    // Check recent signals (last 24 hours)
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const recentSignals = await db.query(
      `SELECT 
        signal_id,
        symbol,
        direction,
        timeframe,
        status,
        created_at,
        raw_payload
       FROM signals 
       WHERE created_at >= $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [last24h]
    );

    if (recentSignals.rows.length > 0) {
      console.log('📝 Recent Signals (Last 24h):');
      recentSignals.rows.forEach((signal: any) => {
        console.log(`   ${signal.created_at.toISOString()} | ${signal.symbol} ${signal.direction} ${signal.timeframe} | ${signal.status}`);
      });
      console.log('');
    }

    // Check experiments (Engine A/B routing)
    const experimentsToday = await db.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN variant = 'A' THEN 1 END) as engine_a,
        COUNT(CASE WHEN variant = 'B' THEN 1 END) as engine_b
       FROM experiments e
       JOIN signals s ON e.signal_id = s.signal_id
       WHERE s.created_at >= $1`,
      [todayStart]
    );

    const expStats = experimentsToday.rows[0];
    console.log('🔀 Engine Routing Today:');
    console.log(`   Total: ${expStats.total}`);
    console.log(`   Engine A: ${expStats.engine_a}`);
    console.log(`   Engine B: ${expStats.engine_b}`);
    console.log('');

    // Check shadow trades (Engine B executions)
    const shadowTradesToday = await db.query(
      `SELECT COUNT(*) as total
       FROM shadow_trades st
       JOIN experiments e ON st.experiment_id = e.experiment_id
       JOIN signals s ON e.signal_id = s.signal_id
       WHERE s.created_at >= $1`,
      [todayStart]
    );

    console.log('💼 Shadow Trades Today:');
    console.log(`   Total: ${shadowTradesToday.rows[0].total}`);
    console.log('');

    // Check for errors in event logs
    const errorLogs = await db.query(
      `SELECT 
        COUNT(*) as error_count,
        event_type,
        MAX(created_at) as last_error
       FROM event_logs
       WHERE created_at >= $1
         AND (event_type LIKE '%error%' OR event_type LIKE '%fail%')
       GROUP BY event_type
       ORDER BY error_count DESC
       LIMIT 5`,
      [todayStart]
    );

    if (errorLogs.rows.length > 0) {
      console.log('❌ Errors Today:');
      errorLogs.rows.forEach((log: any) => {
        console.log(`   ${log.event_type}: ${log.error_count} errors (last: ${log.last_error.toISOString()})`);
      });
      console.log('');
    }

    // Check server health
    console.log('🏥 System Health Checks:');
    
    // Check if database is responsive
    const dbCheck = await db.query('SELECT NOW() as current_time');
    console.log(`   ✅ Database: Connected (${dbCheck.rows[0].current_time.toISOString()})`);

    // Check tables exist
    const tablesCheck = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('signals', 'experiments', 'shadow_trades', 'event_logs')
      ORDER BY table_name
    `);
    console.log(`   ✅ Tables: ${tablesCheck.rows.map((r: any) => r.table_name).join(', ')}`);
    console.log('');

    // Recommendations
    console.log('💡 Next Steps:');
    if (stats.total_signals === '0') {
      console.log('1. Check if your server is running: npm start');
      console.log('2. Test webhook endpoint: curl http://localhost:3000/webhook/test');
      console.log('3. Check TradingView alert settings');
      console.log('4. Review server logs for incoming requests');
      console.log('5. Verify webhook URL in TradingView matches your server');
    } else if (stats.pending > 0) {
      console.log('1. Signals are stuck in pending - check signal processor worker');
      console.log('2. Run: npm run check-workers');
    } else {
      console.log('✅ System appears to be functioning normally');
    }

  } catch (error) {
    console.error('❌ Error checking webhooks:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the check
checkWebhooks().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
