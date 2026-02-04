/**
 * Synthetic Webhook Generator
 * 
 * Generates deterministic TradingView webhook payloads for testing.
 * All generated data is marked with synthetic: true to prevent confusion with live data.
 */

/**
 * Webhook scenario configuration for generating synthetic webhooks
 */
export interface WebhookScenario {
  symbol: string;
  timeframe: string;
  session: string;
  pattern: string;
  price: number;
  volume: number;
  timestamp: number;
  interactionType?: string;
  variant?: 'A' | 'B';
  routingSeed?: string | number;
}

/**
 * TradingView webhook payload structure matching production format
 */
export interface WebhookPayload {
  symbol: string;
  timeframe: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session?: string;
  pattern?: string;
  signal?: string;
  strategy?: string;
}

/**
 * Synthetic webhook with metadata marking it as test data
 */
export interface SyntheticWebhook {
  payload: WebhookPayload;
  metadata: {
    synthetic: true;
    scenario: WebhookScenario;
    generatedAt: number;
  };
}

/**
 * Webhook generator interface for creating synthetic test data
 */
export interface WebhookGenerator {
  /**
   * Generate a single synthetic webhook from a scenario
   */
  generateWebhook(scenario: WebhookScenario): SyntheticWebhook;
  
  /**
   * Generate multiple synthetic webhooks from scenarios
   */
  generateBatch(scenarios: WebhookScenario[]): SyntheticWebhook[];
}
