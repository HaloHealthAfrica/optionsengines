# Phase Test Template

Use this template to implement remaining phase tests. Based on the complete implementation in `webhook-ingestion.test.ts`.

## Template Structure

```typescript
/**
 * Phase X: [Phase Name]
 * 
 * Tests [phase description]
 * 
 * Requirements: [requirement numbers]
 */

import * as fc from 'fast-check';
import { WebhookGenerator } from '../generators/webhook-generator';
import { GEXGenerator } from '../generators/gex-generator';
import { TestOrchestrator } from '../orchestration/test-orchestrator-impl';
import { validate[PhaseName] } from '../validation/[phase]-validator';
import { [ExpectationType] } from '../validation/validation-framework';

describe('Phase X: [Phase Name]', () => {
  let orchestrator: TestOrchestrator;
  let webhookGenerator: WebhookGenerator;
  let gexGenerator: GEXGenerator;

  beforeEach(() => {
    orchestrator = new TestOrchestrator();
    webhookGenerator = new WebhookGenerator();
    gexGenerator = new GEXGenerator();
  });

  afterEach(async () => {
    // Cleanup any test contexts
  });

  describe('X.1 [Phase Name] Test Suite Setup', () => {
    it('should initialize test fixtures', () => {
      // Setup test data
      const data = webhookGenerator.generate({
        symbol: 'SPY',
        timeframe: '5m',
        session: 'RTH_OPEN',
        pattern: 'ORB_BREAKOUT'
      });

      expect(data).toBeDefined();
      expect(data.metadata.synthetic).toBe(true);
    });

    it('should set up test orchestrator', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      expect(context).toBeDefined();
      await orchestrator.teardownTest(context);
    });
  });

  describe('X.2 Property Test: [Property Name]', () => {
    /**
     * Property N: [Property Name]
     * 
     * [Property description]
     * 
     * Validates: Requirements [X.Y]
     */
    it('should [property description]', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Define test scenario parameters
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            // ... other parameters
          }),
          async (scenario) => {
            // Setup test
            const context = await orchestrator.setupTest({
              isolatedEnvironment: true,
              featureFlags: { engineB: true },
              mockExternalAPIs: true,
              captureAllLogs: true
            });

            try {
              // Generate test data
              const data = webhookGenerator.generate(scenario);

              // Inject data
              await orchestrator.injectWebhook(context, data);

              // Wait for processing
              await new Promise(resolve => setTimeout(resolve, 100));

              // Capture state
              const state = await orchestrator.captureState(context);

              // Validate
              const expected: [ExpectationType] = {
                // Define expectations
              };

              const result = validate[PhaseName](state, expected);

              // Property assertion
              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('[Property] violation:', result.message);
                console.error('Details:', result.details);
              }
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 100, seed: [unique_seed] }
      );
    });
  });

  describe('X.3 Unit Tests: Specific [Phase] Scenarios', () => {
    it('should handle [specific scenario]', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Test specific scenario
        const data = webhookGenerator.generate({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT'
        });

        await orchestrator.injectWebhook(context, data);
        await new Promise(resolve => setTimeout(resolve, 100));

        const state = await orchestrator.captureState(context);

        // Assertions
        expect(state).toBeDefined();
        // ... specific assertions
      } finally {
        await orchestrator.teardownTest(context);
      }
    });
  });
});
```

## Key Points

1. **Import Correct Validators**: Use the appropriate validator for your phase
2. **Define Expectations**: Create proper expectation objects for validation
3. **Use Unique Seeds**: Each property test should have a unique seed for reproducibility
4. **Proper Cleanup**: Always teardown test context in finally block
5. **Error Logging**: Log property violations with details for debugging
6. **Test Coverage**: Include both property tests and unit tests
7. **Timeout Handling**: Add appropriate waits for async operations

## Property Test Guidelines

- **numRuns**: Use 100+ for comprehensive coverage
- **seed**: Use unique seed per property for reproducibility
- **Scenarios**: Cover diverse input combinations
- **Assertions**: Use validators from validation framework
- **Error Messages**: Include detailed error information

## Unit Test Guidelines

- **Edge Cases**: Test boundary conditions
- **Error Handling**: Test graceful degradation
- **Specific Scenarios**: Test known problematic cases
- **Integration Points**: Test system integration

## Validation Pattern

```typescript
const expected: [ExpectationType] = {
  // Define what you expect to see
};

const result = validate[PhaseName](state, expected);

expect(result.passed).toBe(true);
if (!result.passed) {
  console.error('Validation failed:', result.message);
  console.error('Expected:', result.expected);
  console.error('Actual:', result.actual);
  console.error('Details:', result.details);
}
```

## Next Steps

1. Copy this template
2. Replace placeholders with phase-specific values
3. Implement property tests based on design document
4. Add unit tests for edge cases
5. Run tests and verify they pass
6. Update PHASE_IMPLEMENTATION_STATUS.md
