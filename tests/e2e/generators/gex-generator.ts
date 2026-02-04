/**
 * Synthetic GEX (Gamma Exposure) Generator
 * 
 * Generates deterministic gamma exposure data for testing.
 * All generated data is marked with synthetic: true to prevent confusion with live data.
 */

/**
 * GEX regime configuration for generating synthetic GEX data
 */
export interface GEXRegime {
  type: 'POSITIVE' | 'NEGATIVE' | 'GAMMA_FLIP_NEAR' | 'NEUTRAL';
  symbol: string;
  spotPrice: number;
  gammaFlipLevel?: number;
}

/**
 * GEX data structure with all required fields
 */
export interface GEXData {
  total_gex: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
  gamma_flip_level: number | null;
}

/**
 * Synthetic GEX with metadata marking it as test data
 */
export interface SyntheticGEX {
  data: GEXData;
  metadata: {
    synthetic: true;
    regime: GEXRegime;
    generatedAt: number;
  };
}

/**
 * GEX generator interface for creating synthetic test data
 */
export interface GEXGenerator {
  /**
   * Generate a single synthetic GEX data from a regime
   */
  generateGEX(regime: GEXRegime): SyntheticGEX;
  
  /**
   * Generate multiple synthetic GEX data from regimes
   */
  generateBatch(regimes: GEXRegime[]): SyntheticGEX[];
}
