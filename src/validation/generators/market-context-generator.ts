/**
 * Market Context Generator for Validation Framework
 * 
 * Generates synthetic market context data including GEX levels, volatility,
 * liquidity, and market regime for validation testing.
 */

import {
  MarketParams,
  MarketContext,
  MarketRegime,
  VolatilityLevel,
  LiquidityLevel,
} from '../types/index.js';

/**
 * Market Context Generator
 * 
 * Creates realistic market context data for validation testing.
 */
export class MarketContextGenerator {
  /**
   * Generate market context
   * 
   * @param params - Market generation parameters
   * @returns Generated market context
   */
  generateMarketContext(params: MarketParams): MarketContext {
    const gexLevel = params.gexLevel;
    const volatilityIndex = this.volatilityToIndex(params.volatility);
    const liquidityScore = this.liquidityToScore(params.liquidity);
    const marketRegime = this.determineMarketRegime(params.volatility, gexLevel);

    return {
      gexLevel,
      volatilityIndex,
      liquidityScore,
      marketRegime,
      marketHours: params.marketHours,
      timestamp: new Date(),
    };
  }

  /**
   * Generate a batch of market contexts
   * 
   * @param paramsList - Array of market parameters
   * @returns Array of generated market contexts
   */
  generateBatch(paramsList: MarketParams[]): MarketContext[] {
    return paramsList.map(params => this.generateMarketContext(params));
  }

  /**
   * Generate market context for extreme volatility
   * 
   * @returns Market context with extreme volatility
   */
  generateExtremeVolatility(): MarketContext {
    return this.generateMarketContext({
      volatility: 'EXTREME',
      liquidity: 'LOW',
      gexLevel: this.randomGexLevel(-5000, -1000), // Negative GEX = volatile
      marketHours: true,
    });
  }

  /**
   * Generate market context for low liquidity
   * 
   * @returns Market context with low liquidity
   */
  generateLowLiquidity(): MarketContext {
    return this.generateMarketContext({
      volatility: 'MEDIUM',
      liquidity: 'LOW',
      gexLevel: this.randomGexLevel(-2000, 2000),
      marketHours: false, // After hours = low liquidity
    });
  }

  /**
   * Generate market context for calm market
   * 
   * @returns Market context for calm conditions
   */
  generateCalmMarket(): MarketContext {
    return this.generateMarketContext({
      volatility: 'LOW',
      liquidity: 'HIGH',
      gexLevel: this.randomGexLevel(5000, 15000), // Positive GEX = calm
      marketHours: true,
    });
  }

  /**
   * Generate market context for volatile market
   * 
   * @returns Market context for volatile conditions
   */
  generateVolatileMarket(): MarketContext {
    return this.generateMarketContext({
      volatility: 'HIGH',
      liquidity: 'MEDIUM',
      gexLevel: this.randomGexLevel(-8000, -2000), // Negative GEX = volatile
      marketHours: true,
    });
  }

  /**
   * Convert volatility level to VIX-like index
   * 
   * @param volatility - Volatility level
   * @returns Volatility index (0-100)
   */
  private volatilityToIndex(volatility: VolatilityLevel): number {
    const ranges = {
      LOW: [10, 15],
      MEDIUM: [15, 25],
      HIGH: [25, 40],
      EXTREME: [40, 80],
    };

    const [min, max] = ranges[volatility];
    return this.randomInRange(min, max);
  }

  /**
   * Convert liquidity level to score
   * 
   * @param liquidity - Liquidity level
   * @returns Liquidity score (0-100)
   */
  private liquidityToScore(liquidity: LiquidityLevel): number {
    const ranges = {
      LOW: [20, 40],
      MEDIUM: [40, 70],
      HIGH: [70, 95],
    };

    const [min, max] = ranges[liquidity];
    return this.randomInRange(min, max);
  }

  /**
   * Determine market regime based on volatility and GEX
   * 
   * @param volatility - Volatility level
   * @param gexLevel - GEX level
   * @returns Market regime
   */
  private determineMarketRegime(volatility: VolatilityLevel, gexLevel: number): MarketRegime {
    // Negative GEX = volatile/bearish
    // Positive GEX = calm/bullish
    
    if (volatility === 'EXTREME' || gexLevel < -5000) {
      return 'VOLATILE';
    }
    
    if (gexLevel < 0) {
      return 'BEARISH';
    }
    
    if (gexLevel > 5000 && volatility === 'LOW') {
      return 'BULLISH';
    }
    
    return 'NEUTRAL';
  }

  /**
   * Generate random GEX level within range
   * 
   * @param min - Minimum GEX level
   * @param max - Maximum GEX level
   * @returns Random GEX level
   */
  private randomGexLevel(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Generate random value within range
   * 
   * @param min - Minimum value
   * @param max - Maximum value
   * @returns Random value
   */
  private randomInRange(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }
}

/**
 * Default market context generator instance
 */
export const marketContextGenerator = new MarketContextGenerator();
