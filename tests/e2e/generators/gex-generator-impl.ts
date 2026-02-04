/**
 * Implementation of the Synthetic GEX Generator
 * 
 * Uses deterministic random seed for reproducibility.
 * Generates realistic GEX data based on regime types.
 * Ensures mathematical consistency: call_gex + put_gex = total_gex, net_gex = call_gex - put_gex
 */

import {
  GEXGenerator,
  GEXRegime,
  SyntheticGEX,
  GEXData,
} from './gex-generator';

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
 * Default implementation of GEXGenerator
 */
export class DefaultGEXGenerator implements GEXGenerator {
  private seed: number;

  constructor(seed: number = 54321) {
    this.seed = seed;
  }

  /**
   * Generate a single synthetic GEX data from a regime
   */
  generateGEX(regime: GEXRegime): SyntheticGEX {
    // Create seeded random generator based on regime for determinism
    const regimeSeed = this.createRegimeSeed(regime);
    const rng = new SeededRandom(regimeSeed);

    // Generate GEX data based on regime type
    const data = this.generateGEXData(regime, rng);

    // Return synthetic GEX with metadata
    return {
      data,
      metadata: {
        synthetic: true,
        regime,
        generatedAt: Date.now(),
      },
    };
  }

  /**
   * Generate multiple synthetic GEX data from regimes
   */
  generateBatch(regimes: GEXRegime[]): SyntheticGEX[] {
    return regimes.map((regime) => this.generateGEX(regime));
  }

  /**
   * Create deterministic seed from regime parameters
   */
  private createRegimeSeed(regime: GEXRegime): number {
    // Hash regime parameters to create deterministic seed
    let hash = this.seed;
    hash = (hash * 31 + this.hashString(regime.type)) >>> 0;
    hash = (hash * 31 + this.hashString(regime.symbol)) >>> 0;
    hash = (hash * 31 + Math.floor(regime.spotPrice * 100)) >>> 0;
    if (regime.gammaFlipLevel !== undefined) {
      hash = (hash * 31 + Math.floor(regime.gammaFlipLevel * 100)) >>> 0;
    }
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
   * Generate GEX data based on regime type
   */
  private generateGEXData(regime: GEXRegime, rng: SeededRandom): GEXData {
    switch (regime.type) {
      case 'POSITIVE':
        return this.generatePositiveGEX(regime, rng);
      
      case 'NEGATIVE':
        return this.generateNegativeGEX(regime, rng);
      
      case 'GAMMA_FLIP_NEAR':
        return this.generateGammaFlipNearGEX(regime, rng);
      
      case 'NEUTRAL':
        return this.generateNeutralGEX(regime, rng);
      
      default:
        throw new Error(`Unknown GEX regime type: ${regime.type}`);
    }
  }

  /**
   * Generate positive GEX regime (total_gex > 0, pinning behavior)
   */
  private generatePositiveGEX(regime: GEXRegime, rng: SeededRandom): GEXData {
    // Positive GEX: more call gamma than put gamma
    // This indicates pinning behavior (market tends to stay near strikes)
    
    // Generate call_gex (positive, larger magnitude)
    const call_gex = rng.range(10_000_000, 20_000_000);
    
    // Generate put_gex (negative, smaller magnitude to ensure total_gex > 0)
    const put_gex = -rng.range(2_000_000, 8_000_000);
    
    // Calculate total_gex (should be positive)
    const total_gex = call_gex + put_gex;
    
    // Calculate net_gex
    const net_gex = call_gex - put_gex;
    
    // Generate gamma flip level (below current spot price for positive GEX)
    // Ignore provided gammaFlipLevel for POSITIVE regime
    const gamma_flip_level = regime.spotPrice * rng.range(0.92, 0.97);
    
    return {
      total_gex,
      call_gex,
      put_gex,
      net_gex,
      gamma_flip_level,
    };
  }

  /**
   * Generate negative GEX regime (total_gex < 0, trending behavior)
   */
  private generateNegativeGEX(regime: GEXRegime, rng: SeededRandom): GEXData {
    // Negative GEX: more put gamma than call gamma
    // This indicates trending behavior (market can move more freely)
    
    // Generate call_gex (positive, smaller magnitude)
    const call_gex = rng.range(2_000_000, 8_000_000);
    
    // Generate put_gex (negative, larger magnitude to ensure total_gex < 0)
    const put_gex = -rng.range(10_000_000, 20_000_000);
    
    // Calculate total_gex (should be negative)
    const total_gex = call_gex + put_gex;
    
    // Calculate net_gex
    const net_gex = call_gex - put_gex;
    
    // Generate gamma flip level (above current spot price for negative GEX)
    // Ignore provided gammaFlipLevel for NEGATIVE regime
    const gamma_flip_level = regime.spotPrice * rng.range(1.03, 1.08);
    
    return {
      total_gex,
      call_gex,
      put_gex,
      net_gex,
      gamma_flip_level,
    };
  }

  /**
   * Generate gamma flip near regime (spotPrice within 1% of flip level)
   */
  private generateGammaFlipNearGEX(regime: GEXRegime, rng: SeededRandom): GEXData {
    // Gamma flip near: spot price is close to the gamma flip level
    // This is a transition zone with increased uncertainty
    
    // Use provided gamma flip level or generate one near spot price
    // Ensure it's within 0.5% to stay well within the 1% requirement
    const gamma_flip_level = regime.gammaFlipLevel ?? 
      regime.spotPrice * rng.range(0.996, 1.004); // Within 0.4%
    
    // Generate balanced GEX values (transitioning between regimes)
    const call_gex = rng.range(3_000_000, 10_000_000);
    const put_gex = -rng.range(3_000_000, 10_000_000);
    
    // Total GEX can be slightly positive or negative
    const total_gex = call_gex + put_gex;
    
    // Calculate net_gex
    const net_gex = call_gex - put_gex;
    
    return {
      total_gex,
      call_gex,
      put_gex,
      net_gex,
      gamma_flip_level,
    };
  }

  /**
   * Generate neutral GEX regime (total_gex near zero)
   */
  private generateNeutralGEX(regime: GEXRegime, rng: SeededRandom): GEXData {
    // Neutral GEX: call and put gamma roughly balanced
    // This indicates baseline behavior without strong directional bias
    
    // Generate large, nearly offsetting call/put gamma
    const magnitude = rng.range(3_000_000, 8_000_000);
    const delta = rng.range(-500, 500); // Keep total_gex near zero
    const call_gex = magnitude + delta / 2;
    const put_gex = -(magnitude - delta / 2);
    
    // Total GEX should be very close to zero
    const total_gex = call_gex + put_gex;
    
    // Calculate net_gex
    const net_gex = call_gex - put_gex;
    
    // Gamma flip level is near current price in neutral regime
    const gamma_flip_level = regime.spotPrice * rng.range(0.98, 1.02);
    
    return {
      total_gex,
      call_gex,
      put_gex,
      net_gex,
      gamma_flip_level,
    };
  }
}

/**
 * Create a GEX generator with optional seed
 */
export function createGEXGenerator(seed?: number): GEXGenerator {
  return new DefaultGEXGenerator(seed);
}
