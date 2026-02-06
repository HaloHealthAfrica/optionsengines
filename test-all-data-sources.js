/**
 * Comprehensive Data Source Testing Script
 * Tests all market data providers and their capabilities
 */

import { marketData } from './dist/services/market-data.js';
import { logger } from './dist/utils/logger.js';

// Test symbols
const TEST_SYMBOLS = ['SPY', 'QQQ', 'AAPL'];
const TEST_TIMEFRAMES = ['5m', '15m', '1h'];

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(80));
  log(title, 'bold');
  console.log('='.repeat(80) + '\n');
}

function subsection(title) {
  log(`\n${title}`, 'cyan');
  log('-'.repeat(title.length), 'cyan');
}

async function testCandles() {
  section('📊 TESTING CANDLE DATA (OHLCV)');
  
  const results = {
    working: [],
    failed: [],
  };

  for (const symbol of TEST_SYMBOLS) {
    for (const timeframe of TEST_TIMEFRAMES) {
      try {
        log(`Testing ${symbol} ${timeframe} candles...`, 'blue');
        const candles = await marketData.getCandles(symbol, timeframe, 50);
        
        if (candles && candles.length > 0) {
          log(`✅ SUCCESS: Got ${candles.length} candles`, 'green');
          log(`   Latest: ${candles[candles.length - 1].close} @ ${candles[candles.length - 1].timestamp}`, 'green');
          results.working.push({ symbol, timeframe, type: 'candles', count: candles.length });
        } else {
          log(`⚠️  WARNING: No candles returned`, 'yellow');
          results.failed.push({ symbol, timeframe, type: 'candles', error: 'No data' });
        }
      } catch (error) {
        log(`❌ FAILED: ${error.message}`, 'red');
        results.failed.push({ symbol, timeframe, type: 'candles', error: error.message });
      }
    }
  }

  return results;
}

async function testPrices() {
  section('💰 TESTING STOCK PRICES');
  
  const results = {
    working: [],
    failed: [],
  };

  for (const symbol of TEST_SYMBOLS) {
    try {
      log(`Testing ${symbol} price...`, 'blue');
      const price = await marketData.getStockPrice(symbol);
      
      if (price && price > 0) {
        log(`✅ SUCCESS: $${price.toFixed(2)}`, 'green');
        results.working.push({ symbol, type: 'price', value: price });
      } else {
        log(`⚠️  WARNING: Invalid price: ${price}`, 'yellow');
        results.failed.push({ symbol, type: 'price', error: 'Invalid price' });
      }
    } catch (error) {
      log(`❌ FAILED: ${error.message}`, 'red');
      results.failed.push({ symbol, type: 'price', error: error.message });
    }
  }

  return results;
}

async function testIndicators() {
  section('📈 TESTING TECHNICAL INDICATORS');
  
  const results = {
    working: [],
    failed: [],
  };

  for (const symbol of TEST_SYMBOLS) {
    try {
      log(`Testing ${symbol} indicators...`, 'blue');
      const indicators = await marketData.getIndicators(symbol, '15m');
      
      if (indicators) {
        log(`✅ SUCCESS: Indicators calculated`, 'green');
        log(`   RSI: ${indicators.rsi?.toFixed(2) || 'N/A'}`, 'green');
        log(`   MACD: ${indicators.macd?.toFixed(2) || 'N/A'}`, 'green');
        log(`   SMA20: ${indicators.sma20?.toFixed(2) || 'N/A'}`, 'green');
        log(`   EMA50: ${indicators.ema50?.toFixed(2) || 'N/A'}`, 'green');
        results.working.push({ symbol, type: 'indicators', data: indicators });
      } else {
        log(`⚠️  WARNING: No indicators returned`, 'yellow');
        results.failed.push({ symbol, type: 'indicators', error: 'No data' });
      }
    } catch (error) {
      log(`❌ FAILED: ${error.message}`, 'red');
      results.failed.push({ symbol, type: 'indicators', error: error.message });
    }
  }

  return results;
}

async function testMarketHours() {
  section('🕐 TESTING MARKET HOURS');
  
  try {
    log('Testing market open status...', 'blue');
    const isOpen = await marketData.isMarketOpen();
    log(`Market is currently: ${isOpen ? 'OPEN 🟢' : 'CLOSED 🔴'}`, isOpen ? 'green' : 'yellow');
    
    log('\nTesting detailed market hours...', 'blue');
    const hours = await marketData.getMarketHours();
    log(`Market open: ${hours.isMarketOpen ? 'YES' : 'NO'}`, hours.isMarketOpen ? 'green' : 'yellow');
    if (hours.minutesUntilClose) {
      log(`Minutes until close: ${hours.minutesUntilClose}`, 'green');
    }
    
    return { working: true };
  } catch (error) {
    log(`❌ FAILED: ${error.message}`, 'red');
    return { working: false, error: error.message };
  }
}

async function testOptionsData() {
  section('📊 TESTING OPTIONS DATA (GEX & FLOW)');
  
  const results = {
    gex: { working: [], failed: [] },
    flow: { working: [], failed: [] },
    chain: { working: [], failed: [] },
  };

  // Test GEX
  subsection('Testing Gamma Exposure (GEX)');
  for (const symbol of ['SPY', 'QQQ']) {
    try {
      log(`Testing ${symbol} GEX...`, 'blue');
      const gex = await marketData.getGex(symbol);
      
      if (gex) {
        log(`✅ SUCCESS: GEX data retrieved`, 'green');
        log(`   Net GEX: ${gex.netGex.toFixed(0)}`, 'green');
        log(`   Call GEX: ${gex.totalCallGex.toFixed(0)}`, 'green');
        log(`   Put GEX: ${gex.totalPutGex.toFixed(0)}`, 'green');
        log(`   Zero Gamma Level: $${gex.zeroGammaLevel?.toFixed(2) || 'N/A'}`, 'green');
        log(`   Dealer Position: ${gex.dealerPosition}`, 'green');
        log(`   Volatility Expectation: ${gex.volatilityExpectation}`, 'green');
        log(`   Strike Levels: ${gex.levels.length}`, 'green');
        results.gex.working.push({ symbol, data: gex });
      } else {
        log(`⚠️  WARNING: No GEX data returned`, 'yellow');
        results.gex.failed.push({ symbol, error: 'No data' });
      }
    } catch (error) {
      log(`❌ FAILED: ${error.message}`, 'red');
      results.gex.failed.push({ symbol, error: error.message });
    }
  }

  // Test Options Flow
  subsection('Testing Options Flow');
  for (const symbol of ['SPY', 'QQQ']) {
    try {
      log(`Testing ${symbol} options flow...`, 'blue');
      const flow = await marketData.getOptionsFlow(symbol, 20);
      
      if (flow && flow.entries) {
        log(`✅ SUCCESS: Options flow retrieved`, 'green');
        log(`   Entries: ${flow.entries.length}`, 'green');
        if (flow.entries.length > 0) {
          const latest = flow.entries[0];
          log(`   Latest: ${latest.side} ${latest.strike} ${latest.sentiment}`, 'green');
        }
        results.flow.working.push({ symbol, count: flow.entries.length });
      } else {
        log(`⚠️  WARNING: No flow data returned`, 'yellow');
        results.flow.failed.push({ symbol, error: 'No data' });
      }
    } catch (error) {
      log(`❌ FAILED: ${error.message}`, 'red');
      results.flow.failed.push({ symbol, error: error.message });
    }
  }

  // Test Options Chain
  subsection('Testing Options Chain');
  for (const symbol of ['SPY']) {
    try {
      log(`Testing ${symbol} options chain...`, 'blue');
      const chain = await marketData.getOptionsChain(symbol);
      
      if (chain && chain.length > 0) {
        log(`✅ SUCCESS: Options chain retrieved`, 'green');
        log(`   Total contracts: ${chain.length}`, 'green');
        const calls = chain.filter(c => c.optionType === 'call').length;
        const puts = chain.filter(c => c.optionType === 'put').length;
        log(`   Calls: ${calls}, Puts: ${puts}`, 'green');
        results.chain.working.push({ symbol, count: chain.length });
      } else {
        log(`⚠️  WARNING: No chain data returned`, 'yellow');
        results.chain.failed.push({ symbol, error: 'No data' });
      }
    } catch (error) {
      log(`❌ FAILED: ${error.message}`, 'red');
      results.chain.failed.push({ symbol, error: error.message });
    }
  }

  return results;
}

async function testOptionPrices() {
  section('💵 TESTING OPTION PRICES');
  
  const results = {
    working: [],
    failed: [],
  };

  // Test option pricing (requires Alpaca or Polygon)
  const testOption = {
    symbol: 'SPY',
    strike: 500,
    expiration: new Date('2024-03-15'),
    type: 'call',
  };

  try {
    log(`Testing ${testOption.symbol} ${testOption.strike} ${testOption.type} option price...`, 'blue');
    const price = await marketData.getOptionPrice(
      testOption.symbol,
      testOption.strike,
      testOption.expiration,
      testOption.type
    );
    
    if (price && price > 0) {
      log(`✅ SUCCESS: $${price.toFixed(2)}`, 'green');
      results.working.push({ ...testOption, price });
    } else {
      log(`⚠️  WARNING: Invalid price: ${price}`, 'yellow');
      results.failed.push({ ...testOption, error: 'Invalid price' });
    }
  } catch (error) {
    log(`❌ FAILED: ${error.message}`, 'red');
    results.failed.push({ ...testOption, error: error.message });
  }

  return results;
}

async function testCircuitBreakers() {
  section('🔌 CIRCUIT BREAKER STATUS');
  
  const status = marketData.getCircuitBreakerStatus();
  
  for (const [provider, state] of Object.entries(status)) {
    const stateColor = state.state === 'closed' ? 'green' : state.state === 'open' ? 'red' : 'yellow';
    log(`${provider.toUpperCase()}: ${state.state.toUpperCase()} (${state.failures} failures)`, stateColor);
  }

  return status;
}

async function testCacheStats() {
  section('💾 CACHE STATISTICS');
  
  const stats = marketData.getCacheStats();
  
  log(`Total entries: ${stats.size}`, 'blue');
  log(`Hit rate: ${((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2)}%`, 'blue');
  log(`Hits: ${stats.hits}`, 'green');
  log(`Misses: ${stats.misses}`, 'yellow');

  return stats;
}

async function generateReport(allResults) {
  section('📋 COMPREHENSIVE DATA SOURCE REPORT');

  subsection('Summary by Data Type');
  
  // Candles
  log('\n📊 CANDLE DATA:', 'bold');
  log(`  ✅ Working: ${allResults.candles.working.length} tests`, 'green');
  log(`  ❌ Failed: ${allResults.candles.failed.length} tests`, 'red');
  
  // Prices
  log('\n💰 STOCK PRICES:', 'bold');
  log(`  ✅ Working: ${allResults.prices.working.length} symbols`, 'green');
  log(`  ❌ Failed: ${allResults.prices.failed.length} symbols`, 'red');
  
  // Indicators
  log('\n📈 TECHNICAL INDICATORS:', 'bold');
  log(`  ✅ Working: ${allResults.indicators.working.length} symbols`, 'green');
  log(`  ❌ Failed: ${allResults.indicators.failed.length} symbols`, 'red');
  
  // Market Hours
  log('\n🕐 MARKET HOURS:', 'bold');
  log(`  ${allResults.marketHours.working ? '✅ Working' : '❌ Failed'}`, 
      allResults.marketHours.working ? 'green' : 'red');
  
  // Options Data
  log('\n📊 OPTIONS DATA:', 'bold');
  log(`  GEX: ✅ ${allResults.options.gex.working.length} / ❌ ${allResults.options.gex.failed.length}`, 
      allResults.options.gex.working.length > 0 ? 'green' : 'red');
  log(`  Flow: ✅ ${allResults.options.flow.working.length} / ❌ ${allResults.options.flow.failed.length}`, 
      allResults.options.flow.working.length > 0 ? 'green' : 'red');
  log(`  Chain: ✅ ${allResults.options.chain.working.length} / ❌ ${allResults.options.chain.failed.length}`, 
      allResults.options.chain.working.length > 0 ? 'green' : 'red');
  
  // Option Prices
  log('\n💵 OPTION PRICES:', 'bold');
  log(`  ✅ Working: ${allResults.optionPrices.working.length} tests`, 'green');
  log(`  ❌ Failed: ${allResults.optionPrices.failed.length} tests`, 'red');

  subsection('Provider Status');
  for (const [provider, state] of Object.entries(allResults.circuitBreakers)) {
    const icon = state.state === 'closed' ? '✅' : state.state === 'open' ? '❌' : '⚠️';
    log(`${icon} ${provider.toUpperCase()}: ${state.state} (${state.failures} failures)`, 
        state.state === 'closed' ? 'green' : 'red');
  }

  subsection('Recommendations');
  
  const failedProviders = Object.entries(allResults.circuitBreakers)
    .filter(([_, state]) => state.state === 'open')
    .map(([provider]) => provider);

  if (failedProviders.length > 0) {
    log('\n⚠️  PROVIDERS NEEDING API KEYS:', 'yellow');
    for (const provider of failedProviders) {
      switch (provider) {
        case 'alpaca':
          log('  • Alpaca: Set ALPACA_API_KEY and ALPACA_SECRET_KEY', 'yellow');
          break;
        case 'polygon':
          log('  • Polygon: Set POLYGON_API_KEY', 'yellow');
          break;
        case 'marketdata':
          log('  • MarketData.app: Set MARKET_DATA_API_KEY', 'yellow');
          break;
        case 'twelvedata':
          log('  • TwelveData: Set TWELVE_DATA_API_KEY', 'yellow');
          break;
      }
    }
  }

  if (allResults.options.gex.failed.length > 0 || allResults.options.flow.failed.length > 0) {
    log('\n⚠️  OPTIONS DATA UNAVAILABLE:', 'yellow');
    log('  • GEX and Options Flow require MarketData.app API key', 'yellow');
    log('  • Set MARKET_DATA_API_KEY environment variable', 'yellow');
  }

  if (allResults.optionPrices.failed.length > 0) {
    log('\n⚠️  OPTION PRICING UNAVAILABLE:', 'yellow');
    log('  • Option prices require Alpaca or Polygon API keys', 'yellow');
    log('  • Set ALPACA_API_KEY/ALPACA_SECRET_KEY or POLYGON_API_KEY', 'yellow');
  }

  subsection('What\'s Working');
  const workingFeatures = [];
  if (allResults.candles.working.length > 0) workingFeatures.push('Stock candles (OHLCV)');
  if (allResults.prices.working.length > 0) workingFeatures.push('Stock prices');
  if (allResults.indicators.working.length > 0) workingFeatures.push('Technical indicators');
  if (allResults.marketHours.working) workingFeatures.push('Market hours');
  if (allResults.options.gex.working.length > 0) workingFeatures.push('Gamma Exposure (GEX)');
  if (allResults.options.flow.working.length > 0) workingFeatures.push('Options flow');
  if (allResults.options.chain.working.length > 0) workingFeatures.push('Options chain');
  if (allResults.optionPrices.working.length > 0) workingFeatures.push('Option prices');

  if (workingFeatures.length > 0) {
    log('', 'green');
    for (const feature of workingFeatures) {
      log(`  ✅ ${feature}`, 'green');
    }
  }

  subsection('What Needs Setup');
  const needsSetup = [];
  if (allResults.options.gex.failed.length > 0) needsSetup.push('GEX data (needs MarketData.app key)');
  if (allResults.options.flow.failed.length > 0) needsSetup.push('Options flow (needs MarketData.app key)');
  if (allResults.optionPrices.failed.length > 0) needsSetup.push('Option prices (needs Alpaca/Polygon key)');

  if (needsSetup.length > 0) {
    log('', 'yellow');
    for (const item of needsSetup) {
      log(`  ⚠️  ${item}`, 'yellow');
    }
  }
}

async function main() {
  log('\n🚀 Starting Comprehensive Data Source Testing...', 'bold');
  log('Testing all market data providers and capabilities\n', 'blue');

  const allResults = {
    candles: await testCandles(),
    prices: await testPrices(),
    indicators: await testIndicators(),
    marketHours: await testMarketHours(),
    options: await testOptionsData(),
    optionPrices: await testOptionPrices(),
    circuitBreakers: await testCircuitBreakers(),
    cache: await testCacheStats(),
  };

  await generateReport(allResults);

  section('✅ TESTING COMPLETE');
  log('All data source tests finished!\n', 'green');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
