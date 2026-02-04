/**
 * Implementation of the Synthetic Webhook Generator
 * 
 * Uses deterministic random seed for reproducibility.
 * Generates realistic price/volume data based on scenario patterns.
 */

import {
  WebhookGenerator,
  WebhookScenario,
  SyntheticWebhook,
  WebhookPayload,
} from './webhook-generator';

/**
 * Seeded random number generator for deterministic test data
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * Generate next random number between 0 and 1
   */
  next(): number {
    // Linear congruential generator
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  /**
   * Generate random number in range [min, max]
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Generate random integer in range [min, max]
   */
  rangeInt(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
}

/**
 * Default implementation of WebhookGenerator
 */
export class DefaultWebhookGenerator implements WebhookGenerator {
  private seed: number;

  constructor(seed: number = 12345) {
    this.seed = seed;
  }

  /**
   * Generate a single synthetic webhook from a scenario
   */
  generateWebhook(scenario: WebhookScenario): SyntheticWebhook {
    // Create seeded random generator based on scenario for determinism
    const scenarioSeed = this.createScenarioSeed(scenario);
    const rng = new SeededRandom(scenarioSeed);

    // Generate OHLCV data based on pattern
    const ohlcv = this.generateOHLCV(scenario, rng);

    // Create webhook payload
    const payload: WebhookPayload = {
      symbol: scenario.symbol,
      timeframe: scenario.timeframe,
      timestamp: scenario.timestamp,
      open: ohlcv.open,
      high: ohlcv.high,
      low: ohlcv.low,
      close: ohlcv.close,
      volume: scenario.volume,
      session: scenario.session,
      pattern: scenario.pattern,
      signal: this.generateSignal(scenario),
      strategy: this.generateStrategy(scenario),
    };

    // Return synthetic webhook with metadata
    return {
      payload,
      metadata: {
        synthetic: true,
        scenario,
        generatedAt: Date.now(),
      },
    };
  }

  /**
   * Generate multiple synthetic webhooks from scenarios
   */
  generateBatch(scenarios: WebhookScenario[]): SyntheticWebhook[] {
    return scenarios.map((scenario) => this.generateWebhook(scenario));
  }

  /**
   * Create deterministic seed from scenario parameters
   */
  private createScenarioSeed(scenario: WebhookScenario): number {
    // Hash scenario parameters to create deterministic seed
    let hash = this.seed;
    hash = (hash * 31 + this.hashString(scenario.symbol)) >>> 0;
    hash = (hash * 31 + this.hashString(scenario.timeframe)) >>> 0;
    hash = (hash * 31 + this.hashString(scenario.session)) >>> 0;
    hash = (hash * 31 + this.hashString(scenario.pattern)) >>> 0;
    hash = (hash * 31 + Math.floor(scenario.price)) >>> 0;
    hash = (hash * 31 + Math.floor(scenario.volume)) >>> 0;
    hash = (hash * 31 + Math.floor(scenario.timestamp / 1000)) >>> 0;
    return hash;
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  /**
   * Generate OHLCV data based on pattern
   */
  private generateOHLCV(
    scenario: WebhookScenario,
    rng: SeededRandom
  ): { open: number; high: number; low: number; close: number } {
    const basePrice = scenario.price;
    
    // Pattern-specific price movements
    switch (scenario.pattern) {
      case 'ORB_BREAKOUT':
        return this.generateORBBreakout(basePrice, rng);
      
      case 'ORB_FAKEOUT':
        return this.generateORBFakeout(basePrice, rng);
      
      case 'TREND_CONTINUATION':
        return this.generateTrendContinuation(basePrice, rng);
      
      case 'CHOP':
        return this.generateChop(basePrice, rng);
      
      case 'VOL_COMPRESSION':
        return this.generateVolCompression(basePrice, rng);
      
      case 'VOL_EXPANSION':
        return this.generateVolExpansion(basePrice, rng);
      
      default:
        // Default to simple candle
        return this.generateSimpleCandle(basePrice, rng);
    }
  }

  /**
   * Generate ORB breakout pattern (strong directional move)
   */
  private generateORBBreakout(
    basePrice: number,
    rng: SeededRandom
  ): { open: number; high: number; low: number; close: number } {
    const open = basePrice;
    const direction = rng.next() > 0.5 ? 1 : -1;
    const movePercent = rng.range(0.005, 0.015); // 0.5% to 1.5% move
    
    if (direction > 0) {
      // Bullish breakout
      const close = open * (1 + movePercent);
      const high = close * (1 + rng.range(0.001, 0.003));
      const low = open * (1 - rng.range(0.001, 0.002));
      return { open, high, low, close };
    } else {
      // Bearish breakout
      const close = open * (1 - movePercent);
      const high = open * (1 + rng.range(0.001, 0.002));
      const low = close * (1 - rng.range(0.001, 0.003));
      return { open, high, low, close };
    }
  }

  /**
   * Generate ORB fakeout pattern (initial move then reversal)
   */
  private generateORBFakeout(
    basePrice: number,
    rng: SeededRandom
  ): { open: number; high: number; low: number; close: number } {
    const open = basePrice;
    const direction = rng.next() > 0.5 ? 1 : -1;
    const fakeoutPercent = rng.range(0.003, 0.008); // 0.3% to 0.8% fake move
    const reversalPercent = rng.range(0.002, 0.006); // 0.2% to 0.6% reversal
    
    if (direction > 0) {
      // Fake bullish then bearish close
      const high = open * (1 + fakeoutPercent);
      const close = open * (1 - reversalPercent);
      const low = close * (1 - rng.range(0.001, 0.002));
      return { open, high, low, close };
    } else {
      // Fake bearish then bullish close
      const low = open * (1 - fakeoutPercent);
      const close = open * (1 + reversalPercent);
      const high = close * (1 + rng.range(0.001, 0.002));
      return { open, high, low, close };
    }
  }

  /**
   * Generate trend continuation pattern (steady directional move)
   */
  private generateTrendContinuation(
    basePrice: number,
    rng: SeededRandom
  ): { open: number; high: number; low: number; close: number } {
    const open = basePrice;
    const direction = rng.next() > 0.5 ? 1 : -1;
    const movePercent = rng.range(0.003, 0.008); // 0.3% to 0.8% steady move
    
    if (direction > 0) {
      // Bullish continuation
      const close = open * (1 + movePercent);
      const high = close * (1 + rng.range(0.0005, 0.001));
      const low = open * (1 - rng.range(0.0005, 0.001));
      return { open, high, low, close };
    } else {
      // Bearish continuation
      const close = open * (1 - movePercent);
      const high = open * (1 + rng.range(0.0005, 0.001));
      const low = close * (1 - rng.range(0.0005, 0.001));
      return { open, high, low, close };
    }
  }

  /**
   * Generate choppy market pattern (small range, indecisive)
   */
  private generateChop(
    basePrice: number,
    rng: SeededRandom
  ): { open: number; high: number; low: number; close: number } {
    const open = basePrice;
    const rangePercent = rng.range(0.001, 0.003); // 0.1% to 0.3% range
    
    const high = open * (1 + rangePercent);
    const low = open * (1 - rangePercent);
    const close = open * (1 + rng.range(-rangePercent, rangePercent));
    
    return { open, high, low, close };
  }

  /**
   * Generate volatility compression pattern (very tight range)
   */
  private generateVolCompression(
    basePrice: number,
    rng: SeededRandom
  ): { open: number; high: number; low: number; close: number } {
    const open = basePrice;
    const rangePercent = rng.range(0.0005, 0.0015); // 0.05% to 0.15% range
    
    const high = open * (1 + rangePercent);
    const low = open * (1 - rangePercent);
    const close = open * (1 + rng.range(-rangePercent * 0.5, rangePercent * 0.5));
    
    return { open, high, low, close };
  }

  /**
   * Generate volatility expansion pattern (wide range)
   */
  private generateVolExpansion(
    basePrice: number,
    rng: SeededRandom
  ): { open: number; high: number; low: number; close: number } {
    const open = basePrice;
    const rangePercent = rng.range(0.01, 0.025); // 1% to 2.5% range
    
    const high = open * (1 + rangePercent);
    const low = open * (1 - rangePercent);
    const close = open * (1 + rng.range(-rangePercent * 0.7, rangePercent * 0.7));
    
    return { open, high, low, close };
  }

  /**
   * Generate simple candle (default pattern)
   */
  private generateSimpleCandle(
    basePrice: number,
    rng: SeededRandom
  ): { open: number; high: number; low: number; close: number } {
    const open = basePrice;
    const movePercent = rng.range(-0.005, 0.005); // -0.5% to +0.5%
    const close = open * (1 + movePercent);
    
    const high = Math.max(open, close) * (1 + rng.range(0.001, 0.003));
    const low = Math.min(open, close) * (1 - rng.range(0.001, 0.003));
    
    return { open, high, low, close };
  }

  /**
   * Generate signal based on pattern
   */
  private generateSignal(scenario: WebhookScenario): string {
    switch (scenario.pattern) {
      case 'ORB_BREAKOUT':
        return 'ORB_BREAK';
      case 'ORB_FAKEOUT':
        return 'ORB_FAKE';
      case 'TREND_CONTINUATION':
        return 'TREND_CONT';
      case 'CHOP':
        return 'CHOP';
      case 'VOL_COMPRESSION':
        return 'VOL_COMP';
      case 'VOL_EXPANSION':
        return 'VOL_EXP';
      default:
        return 'SIGNAL';
    }
  }

  /**
   * Generate strategy name based on session and pattern
   */
  private generateStrategy(scenario: WebhookScenario): string {
    const sessionPrefix = scenario.session.replace('_', '-');
    const patternSuffix = scenario.pattern.replace('_', '-');
    return `${sessionPrefix}-${patternSuffix}`;
  }
}

/**
 * Create a webhook generator with optional seed
 */
export function createWebhookGenerator(seed?: number): WebhookGenerator {
  return new DefaultWebhookGenerator(seed);
}
