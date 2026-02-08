import { db } from './database.service.js';

export async function getProductionWebhookSchema(): Promise<any> {
  const recent = await db.query(
    `SELECT raw_payload
     FROM signals
     WHERE COALESCE(is_test, false) = false
     ORDER BY created_at DESC
     LIMIT 1`
  );

  const example = recent.rows[0]?.raw_payload || null;

  return {
    schema_version: '1.0',
    webhook_format: 'optionagents_v1',
    required_fields: ['symbol_or_ticker', 'timeframe', 'direction'],
    optional_fields: ['timestamp', 'price', 'indicators', 'metadata', 'action', 'signal', 'side'],
    field_definitions: {
      symbol: { type: 'string', example: 'SPY' },
      ticker: { type: 'string', example: 'SPY' },
      timeframe: { type: 'string', example: '5m' },
      direction: { type: 'string', enum: ['long', 'short'], example: 'long' },
      action: { type: 'string', enum: ['BUY', 'SELL'], example: 'BUY' },
      timestamp: { type: 'string', format: 'iso8601' },
      price: { type: 'number', min: 0 },
      indicators: { type: 'object' },
    },
    template: example || {
      symbol: '{{SYMBOL}}',
      timeframe: '{{TIMEFRAME}}',
      direction: '{{DIRECTION}}',
      timestamp: '{{TIMESTAMP}}',
      price: '{{PRICE}}',
      indicators: {
        rsi: '{{RSI}}',
        macd: '{{MACD}}',
        volume: '{{VOLUME}}',
      },
      metadata: {
        is_test: true,
        test_session_id: '{{TEST_SESSION_ID}}',
      },
    },
  };
}
