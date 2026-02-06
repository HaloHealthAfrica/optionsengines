/**
 * Webhook Diagnostic Script
 * 
 * Checks:
 * 1. Recent webhook attempts in logs
 * 2. Signals in database (today)
 * 3. Server connectivity
 * 4. HMAC configuration
 * 5. Feature flag status
 */

import { db } from '../src/services/database.service.js';
import { featureFlags } from '../src/services/feature-flag.service.js';
import { config } from '../src/config/index.js';
import { logger } from '../src/utils/logger.js';

async function diagnoseWebhooks() {
  console.log('🔍 Webhook Diagnostic Report\n');
  console.log('=' .repeat(60));
  
  try {
    // 1. Check database connection
    console.log('\n1️⃣  Database Connection');
    console.log('-'.repeat(60));
    try {
      const dbTest = await db.query('SELECT NOW() as current_time');
      console.log('✅ Database connected');
      console.log(`   Current DB time: ${dbTest.rows[0].current_time}`);
    } catch (error: any) {
      console.log('❌ Database connection failed:', error.message);
      return;
    }

    // 2. Check signals received today
    console.log('\n2️⃣  Signals Received Today');
    console.log('-'.repeat(60));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const signalsResult = await db.query(
      `SELECT 
        status,
        COUNT(*) as count,
        MIN(created_at) as first_signal,
        MAX(created_at) as last_signal
       FROM signals 
       WHERE created_at >= $1
       GROUP BY status
       ORDER BY status`,
      [today]
    );

    if (signalsResult.rows.length === 0) {
      console.log('⚠️  No signals received today');
    } else {
      console.log('✅ Signals found:');
      for (const row of signalsResult.rows) {
        console.log(`   ${row.status}: ${row.count} signals`);
        console.log(`      First: ${row.first_signal}`);
        console.log(`      Last: ${row.last_signal}`);
      }
    }

    // 3. Check recent signals (last 24 hours)
    console.log('\n3️⃣  Recent Signals (Last 24 Hours)');
    console.log('-'.repeat(60));
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const recentSignals = await db.query(
      `SELECT 
        signal_id,
        symbol,
        direction,
        timeframe,
        status,
        created_at
       FROM signals 
       WHERE created_at >= $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [yesterday]
    );

    if (recentSignals.rows.length === 0) {
      console.log('⚠️  No signals in last 24 hours');
    } else {
      console.log(`✅ Found ${recentSignals.rows.length} recent signals:`);
      for (const signal of recentSignals.rows) {
        console.log(`   ${signal.created_at} | ${signal.symbol} ${signal.direction} ${signal.timeframe} | ${signal.status}`);
      }
    }

    // 4. Check server configuration
    console.log('\n4️⃣  Server Configuration');
    console.log('-'.repeat(60));
    console.log(`   Port: ${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   App Mode: ${config.appMode}`);
    console.log(`   HMAC Secret: ${config.hmacSecret ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   JWT Secret: ${config.jwtSecret ? '✅ Configured' : '❌ Not configured'}`);

    // 5. Check feature flags
    console.log('\n5️⃣  Feature Flags');
    console.log('-'.repeat(60));
    await featureFlags.init();
    
    const flags = [
      'enable_variant_b',
      'enable_shadow_execution',
      'enable_orb_specialist',
      'enable_strat_specialist',
      'enable_ttm_specialist',
    ];

    for (const flag of flags) {
      const enabled = featureFlags.isEnabled(flag);
      console.log(`   ${flag}: ${enabled ? '✅ Enabled' : '❌ Disabled'}`);
    }

    // 6. Check A/B split configuration
    console.log('\n6️⃣  A/B Testing Configuration');
    console.log('-'.repeat(60));
    console.log(`   Variant B Enabled: ${config.enableVariantB ? '✅ Yes' : '❌ No'}`);
    console.log(`   Split Percentage: ${config.abSplitPercentage}%`);

    // 7. Check experiments table
    console.log('\n7️⃣  Experiments (Last 24 Hours)');
    console.log('-'.repeat(60));
    const experiments = await db.query(
      `SELECT 
        variant,
        COUNT(*) as count
       FROM experiments 
       WHERE created_at >= $1
       GROUP BY variant
       ORDER BY variant`,
      [yesterday]
    );

    if (experiments.rows.length === 0) {
      console.log('⚠️  No experiments in last 24 hours');
    } else {
      console.log('✅ Experiments found:');
      for (const row of experiments.rows) {
        console.log(`   Engine ${row.variant}: ${row.count} signals`);
      }
    }

    // 8. Check shadow trades
    console.log('\n8️⃣  Shadow Trades (Last 24 Hours)');
    console.log('-'.repeat(60));
    const shadowTrades = await db.query(
      `SELECT COUNT(*) as count FROM shadow_trades WHERE entry_timestamp >= $1`,
      [yesterday]
    );
    console.log(`   Shadow trades: ${shadowTrades.rows[0].count}`);

    // 9. Check workers status
    console.log('\n9️⃣  Worker Configuration');
    console.log('-'.repeat(60));
    console.log(`   Signal Processor Interval: ${config.signalProcessorInterval}ms`);
    console.log(`   Order Creator Interval: ${config.orderCreatorInterval}ms`);
    console.log(`   Paper Executor Interval: ${config.paperExecutorInterval}ms`);

    // 10. Recommendations
    console.log('\n🔧 Recommendations');
    console.log('='.repeat(60));
    
    if (signalsResult.rows.length === 0) {
      console.log('\n❌ NO SIGNALS RECEIVED TODAY');
      console.log('\nPossible causes:');
      console.log('   1. TradingView webhook not configured or not firing');
      console.log('   2. Webhook URL incorrect in TradingView');
      console.log('   3. Server not accessible from TradingView');
      console.log('   4. HMAC signature mismatch');
      console.log('   5. Firewall blocking incoming requests');
      console.log('\nNext steps:');
      console.log('   1. Check TradingView alert settings');
      console.log('   2. Verify webhook URL is correct');
      console.log('   3. Test webhook endpoint manually:');
      console.log('      node test-webhook.js');
      console.log('   4. Check server logs for rejected requests');
      console.log('   5. Verify HMAC_SECRET matches TradingView configuration');
    } else {
      console.log('✅ Signals are being received');
      
      const pendingCount = signalsResult.rows.find(r => r.status === 'pending')?.count || 0;
      const approvedCount = signalsResult.rows.find(r => r.status === 'approved')?.count || 0;
      const rejectedCount = signalsResult.rows.find(r => r.status === 'rejected')?.count || 0;
      
      if (pendingCount > 0) {
        console.log(`\n⚠️  ${pendingCount} signals still pending - check signal processor worker`);
      }
      
      if (rejectedCount > approvedCount) {
        console.log(`\n⚠️  More signals rejected (${rejectedCount}) than approved (${approvedCount})`);
        console.log('   Check rejection reasons in refactored_signals table');
      }
    }

  } catch (error: any) {
    console.error('\n❌ Diagnostic failed:', error.message);
    console.error(error.stack);
  } finally {
    await db.end();
    process.exit(0);
  }
}

diagnoseWebhooks();
