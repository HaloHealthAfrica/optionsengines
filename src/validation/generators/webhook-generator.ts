/**
 * Webhook Payload Generator for Validation Framework
 * 
 * Generates synthetic TradingView webhook payloads for validation testing.
 * Supports valid, malformed, and edge case webhook generation.
 */

import crypto from 'crypto';
import {
  WebhookParams,
  WebhookPayload,
} from '../types/index.js';

/**
 * Strategy names for realistic webhook generation
 */
const STRATEGIES = [
  'ORB', 'TTM', 'GAMMA_FLOW', 'STRAT', 'SWING', 'LEAPS', 'SCALP',
  'IRON_CONDOR', 'BUTTERFLY', 'VERTICAL_SPREAD',
];

/**
 * Timeframes for realistic webhook generation
 */
const TIMEFRAMES = [
  '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w',
];

/**
 * Webhook Payload Generator
 * 
 * Creates realistic TradingView webhook payloads for validation testing.
 */
export class WebhookGenerator {
  private secretKey: string;

  constructor(secretKey: string = 'test-secret-key') {
    this.secretKey = secretKey;
  }

  /**
   * Generate a webhook payload
   * 
   * @param params - Webhook generation parameters
   * @returns Generated webhook payload
   */
  generateWebhook(params: WebhookParams): WebhookPayload {
    // Handle malformed payload generation
    if (params.malformed) {
      return this.generateMalformedWebhook(params);
    }

    // Generate valid webhook
    const payload: WebhookPayload = {
      strategy: params.strategy || this.randomStrategy(),
      timeframe: params.timeframe || this.randomTimeframe(),
      direction: params.direction,
      confidence: params.confidence !== undefined ? params.confidence : this.randomConfidence(),
      timestamp: new Date(),
      metadata: {
        synthetic: true,
        generatedAt: Date.now(),
        version: '1.0',
      },
    };

    // Add signature if requested
    if (params.includeSignature) {
      payload.signature = this.generateSignature(payload);
    }

    return payload;
  }

  /**
   * Generate a batch of webhook payloads
   * 
   * @param paramsList - Array of webhook parameters
   * @returns Array of generated webhooks
   */
  generateBatch(paramsList: WebhookParams[]): WebhookPayload[] {
    return paramsList.map(params => this.generateWebhook(params));
  }

  /**
   * Generate a webhook with valid signature
   * 
   * @param params - Webhook generation parameters
   * @returns Webhook with valid signature
   */
  generateWithValidSignature(params: WebhookParams): WebhookPayload {
    return this.generateWebhook({ ...params, includeSignature: true });
  }

  /**
   * Generate a webhook with invalid signature
   * 
   * @param params - Webhook generation parameters
   * @returns Webhook with invalid signature
   */
  generateWithInvalidSignature(params: WebhookParams): WebhookPayload {
    const webhook = this.generateWebhook({ ...params, includeSignature: false });
    webhook.signature = 'invalid-signature-' + Math.random().toString(36).substring(7);
    return webhook;
  }

  /**
   * Generate a malformed webhook payload
   * 
   * @param params - Webhook generation parameters
   * @returns Malformed webhook payload
   */
  private generateMalformedWebhook(params: WebhookParams): any {
    const malformedTypes = [
      // Missing required fields
      () => ({
        strategy: params.strategy,
        // Missing timeframe, direction, confidence
        timestamp: new Date(),
        metadata: { synthetic: true },
      }),
      // Invalid data types
      () => ({
        strategy: 123, // Should be string
        timeframe: params.timeframe,
        direction: params.direction,
        confidence: 'high', // Should be number
        timestamp: new Date(),
        metadata: { synthetic: true },
      }),
      // Null values
      () => ({
        strategy: null,
        timeframe: params.timeframe,
        direction: params.direction,
        confidence: params.confidence,
        timestamp: new Date(),
        metadata: { synthetic: true },
      }),
      // Invalid enum values
      () => ({
        strategy: params.strategy,
        timeframe: params.timeframe,
        direction: 'INVALID_DIRECTION', // Should be LONG or SHORT
        confidence: params.confidence,
        timestamp: new Date(),
        metadata: { synthetic: true },
      }),
      // Completely invalid structure
      () => ({
        invalid: 'structure',
        random: 'fields',
        metadata: { synthetic: true },
      }),
      // Missing timestamp
      () => ({
        strategy: params.strategy,
        timeframe: params.timeframe,
        direction: params.direction,
        confidence: params.confidence,
        // Missing timestamp
        metadata: { synthetic: true },
      }),
    ];

    // Pick a random malformed type
    const malformedGenerator = malformedTypes[Math.floor(Math.random() * malformedTypes.length)];
    return malformedGenerator();
  }

  /**
   * Generate a signature for webhook authentication
   * 
   * @param payload - Webhook payload to sign
   * @returns HMAC signature
   */
  private generateSignature(payload: WebhookPayload): string {
    // Create a canonical string representation of the payload
    const canonicalString = JSON.stringify({
      strategy: payload.strategy,
      timeframe: payload.timeframe,
      direction: payload.direction,
      confidence: payload.confidence,
      timestamp: payload.timestamp.toISOString(),
    });

    // Generate HMAC-SHA256 signature
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(canonicalString);
    return hmac.digest('hex');
  }

  /**
   * Get a random strategy
   */
  private randomStrategy(): string {
    return STRATEGIES[Math.floor(Math.random() * STRATEGIES.length)];
  }

  /**
   * Get a random timeframe
   */
  private randomTimeframe(): string {
    return TIMEFRAMES[Math.floor(Math.random() * TIMEFRAMES.length)];
  }

  /**
   * Generate a random confidence value (0-100)
   */
  private randomConfidence(): number {
    return Math.floor(Math.random() * 101);
  }

  /**
   * Generate a webhook with missing required fields
   * 
   * @param missingFields - Fields to omit
   * @returns Webhook with missing fields
   */
  generateWithMissingFields(missingFields: string[]): any {
    const params: WebhookParams = {
      strategy: 'ORB',
      timeframe: '5m',
      direction: 'LONG',
      confidence: 75,
    };

    const webhook = this.generateWebhook(params) as any;

    // Remove specified fields
    missingFields.forEach(field => {
      delete webhook[field];
    });

    return webhook;
  }

  /**
   * Generate a webhook with confidence outside valid range
   * 
   * @param confidence - Invalid confidence value
   * @returns Webhook with invalid confidence
   */
  generateWithInvalidConfidence(confidence: number): WebhookPayload {
    return this.generateWebhook({
      strategy: 'ORB',
      timeframe: '5m',
      direction: 'LONG',
      confidence,
    });
  }

  /**
   * Generate a duplicate webhook (same idempotency key)
   * 
   * @param original - Original webhook
   * @returns Duplicate webhook
   */
  generateDuplicate(original: WebhookPayload): WebhookPayload {
    return {
      ...original,
      metadata: {
        ...original.metadata,
        generatedAt: Date.now(), // Different generation time but same content
      },
    };
  }
}

/**
 * Default webhook generator instance
 */
export const webhookGenerator = new WebhookGenerator();
