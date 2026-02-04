/**
 * Property-Based Test: Agent output schema compliance
 * Property 25: Agent output conforms to schema
 * Validates: Requirements 9.4
 */

import fc from 'fast-check';
import { BaseAgent } from '../../agents/base-agent.js';
import { EnrichedSignal, MarketData } from '../../types/index.js';

class DummyAgent extends BaseAgent {
  async analyze(_signal: EnrichedSignal, _marketData: MarketData) {
    return this.buildOutput('neutral', 50, ['ok'], false);
  }

  exposeBuildOutput(
    bias: 'bullish' | 'bearish' | 'neutral',
    confidence: number,
    reasons: string[],
    block: boolean,
    metadata?: Record<string, any>
  ) {
    return this.buildOutput(bias, confidence, reasons, block, metadata);
  }
}

describe('Property 25: Agent output schema compliance', () => {
  const biasArb = fc.constantFrom<'bullish' | 'bearish' | 'neutral'>(
    'bullish',
    'bearish',
    'neutral'
  );
  const confidenceArb = fc.integer({ min: 0, max: 100 });
  const reasonsArb = fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
    minLength: 1,
    maxLength: 5,
  });
  const blockArb = fc.boolean();

  test('Property: Valid outputs pass schema validation', async () => {
    const agent = new DummyAgent('dummy', 'core');

    await fc.assert(
      fc.asyncProperty(biasArb, confidenceArb, reasonsArb, blockArb, async (bias, confidence, reasons, block) => {
        const output = agent.exposeBuildOutput(bias, confidence, reasons, block);
        expect(output.agent).toBe('dummy');
        expect(output.bias).toBe(bias);
        expect(output.confidence).toBe(confidence);
        expect(output.reasons).toEqual(reasons);
        expect(output.block).toBe(block);
      }),
      { numRuns: 100 }
    );
  });
});
