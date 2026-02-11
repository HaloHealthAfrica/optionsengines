/**
 * Example Usage of Synthetic GEX Generator
 * 
 * This file demonstrates how to use the GEX generator to create
 * synthetic gamma exposure data for testing.
 */

import { createGEXGenerator, GEXRegime } from './index';

// Create a GEX generator with a deterministic seed
const generator = createGEXGenerator(54321);

// Example 1: Generate positive GEX regime (pinning behavior)
console.log('=== Example 1: Positive GEX Regime ===');
const positiveRegime: GEXRegime = {
  type: 'POSITIVE',
  symbol: 'SPY',
  spotPrice: 450.00,
};
const positiveGEX = generator.generateGEX(positiveRegime);
console.log('Positive GEX Data:', positiveGEX.data);
console.log('Total GEX:', positiveGEX.data.total_gex, '(should be > 0)');
console.log('Gamma Flip Level:', positiveGEX.data.gamma_flip_level, '(should be < spot price)');
console.log('Synthetic:', positiveGEX.metadata.synthetic);
console.log();

// Example 2: Generate negative GEX regime (trending behavior)
console.log('=== Example 2: Negative GEX Regime ===');
const negativeRegime: GEXRegime = {
  type: 'NEGATIVE',
  symbol: 'QQQ',
  spotPrice: 380.00,
};
const negativeGEX = generator.generateGEX(negativeRegime);
console.log('Negative GEX Data:', negativeGEX.data);
console.log('Total GEX:', negativeGEX.data.total_gex, '(should be < 0)');
console.log('Gamma Flip Level:', negativeGEX.data.gamma_flip_level, '(should be > spot price)');
console.log('Synthetic:', negativeGEX.metadata.synthetic);
console.log();

// Example 3: Generate gamma flip near regime (transition zone)
console.log('=== Example 3: Gamma Flip Near Regime ===');
const gammaFlipNearRegime: GEXRegime = {
  type: 'GAMMA_FLIP_NEAR',
  symbol: 'SPX',
  spotPrice: 4500.00,
};
const gammaFlipNearGEX = generator.generateGEX(gammaFlipNearRegime);
console.log('Gamma Flip Near GEX Data:', gammaFlipNearGEX.data);
console.log('Total GEX:', gammaFlipNearGEX.data.total_gex, '(can be slightly positive or negative)');
console.log('Gamma Flip Level:', gammaFlipNearGEX.data.gamma_flip_level);
console.log('Distance from spot:', Math.abs(gammaFlipNearGEX.data.gamma_flip_level! - gammaFlipNearRegime.spotPrice));
console.log('Percent difference:', (Math.abs(gammaFlipNearGEX.data.gamma_flip_level! - gammaFlipNearRegime.spotPrice) / gammaFlipNearRegime.spotPrice * 100).toFixed(2) + '%', '(should be < 1%)');
console.log('Synthetic:', gammaFlipNearGEX.metadata.synthetic);
console.log();

// Example 4: Generate neutral GEX regime (balanced)
console.log('=== Example 4: Neutral GEX Regime ===');
const neutralRegime: GEXRegime = {
  type: 'NEUTRAL',
  symbol: 'SPY',
  spotPrice: 450.00,
};
const neutralGEX = generator.generateGEX(neutralRegime);
console.log('Neutral GEX Data:', neutralGEX.data);
console.log('Total GEX:', neutralGEX.data.total_gex, '(should be near zero)');
console.log('Call GEX:', neutralGEX.data.call_gex);
console.log('Put GEX:', neutralGEX.data.put_gex);
console.log('Synthetic:', neutralGEX.metadata.synthetic);
console.log();

// Example 5: Generate gamma flip near with specific flip level
console.log('=== Example 5: Gamma Flip Near with Specific Level ===');
const specificFlipRegime: GEXRegime = {
  type: 'GAMMA_FLIP_NEAR',
  symbol: 'SPY',
  spotPrice: 450.00,
  gammaFlipLevel: 451.00, // Specify exact flip level
};
const specificFlipGEX = generator.generateGEX(specificFlipRegime);
console.log('Specific Flip GEX Data:', specificFlipGEX.data);
console.log('Gamma Flip Level:', specificFlipGEX.data.gamma_flip_level, '(should be 451.00)');
console.log('Synthetic:', specificFlipGEX.metadata.synthetic);
console.log();

// Example 6: Generate batch of GEX data
console.log('=== Example 6: Batch Generation ===');
const regimes: GEXRegime[] = [
  { type: 'POSITIVE', symbol: 'SPY', spotPrice: 450.00 },
  { type: 'NEGATIVE', symbol: 'QQQ', spotPrice: 380.00 },
  { type: 'NEUTRAL', symbol: 'SPX', spotPrice: 4500.00 },
];
const gexBatch = generator.generateBatch(regimes);
console.log('Generated', gexBatch.length, 'GEX data points');
gexBatch.forEach((gex, index) => {
  console.log(`  ${index + 1}. ${gex.metadata.regime.type} regime for ${gex.metadata.regime.symbol}: total_gex = ${gex.data.total_gex.toFixed(2)}`);
});
console.log();

// Example 7: Verify mathematical consistency
console.log('=== Example 7: Mathematical Consistency ===');
const testRegime: GEXRegime = {
  type: 'POSITIVE',
  symbol: 'SPY',
  spotPrice: 450.00,
};
const testGEX = generator.generateGEX(testRegime);
console.log('Call GEX:', testGEX.data.call_gex);
console.log('Put GEX:', testGEX.data.put_gex);
console.log('Total GEX:', testGEX.data.total_gex);
console.log('Calculated Total (call + put):', testGEX.data.call_gex + testGEX.data.put_gex);
console.log('Match:', Math.abs((testGEX.data.call_gex + testGEX.data.put_gex) - testGEX.data.total_gex) < 0.01);
console.log();
console.log('Net GEX:', testGEX.data.net_gex);
console.log('Calculated Net (call - put):', testGEX.data.call_gex - testGEX.data.put_gex);
console.log('Match:', Math.abs((testGEX.data.call_gex - testGEX.data.put_gex) - testGEX.data.net_gex) < 0.01);
console.log();

// Example 8: Determinism - same input produces same output
console.log('=== Example 8: Determinism ===');
const regime1: GEXRegime = {
  type: 'POSITIVE',
  symbol: 'SPY',
  spotPrice: 450.00,
};
const gex1 = generator.generateGEX(regime1);
const gex2 = generator.generateGEX(regime1);
console.log('First generation total_gex:', gex1.data.total_gex);
console.log('Second generation total_gex:', gex2.data.total_gex);
console.log('Identical:', gex1.data.total_gex === gex2.data.total_gex);
console.log();
