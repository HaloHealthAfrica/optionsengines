# E2E Testing System with Synthetic Data

## Overview

This E2E testing system provides comprehensive validation for a dual-engine options trading platform. It uses synthetic data generation, property-based testing, and deterministic test orchestration to ensure system correctness while maintaining strict isolation from production.

## Architecture

### Components

1. **Synthetic Data Generators** (`generators/`)
   - Webhook Generator: Creates deterministic TradingView webhook payloads
   - GEX Generator: Creates gamma exposure data for different market regimes

2. **Test Orchestrator** (`orchestration/`)
   - Manages test lifecycle (setup, execution, teardown)
   - Injects synthetic data into system under test
   - Captures system state for validation
   - Provides replay functionality for determinism testing

3. **Validation Framework** (`validation/`)
   - Webhook Ingestion Validator
   - Routing Validator
   - Engine A Validator
   - Engine B Validator
   - Logging Validator
   - Determinism Validator

4. **Test Phases** (`phases/`)
   - Phase 1: Webhook Ingestion
   - Phase 2: Strategy Router
   - Phase 3: Engine A Regression
   - Phase 4: Engine B Multi-Agent
   - Phase 5: Risk Veto
   - Phase 6: Shadow Execution
   - Phase 7: Strategy Interaction
   - Phase 8: GEX Regime
   - Phase 9: Logging and Attribution
   - Phase 10: Feature Flags
   - Phase 11: Determinism
   - Phase 12: Safety and Isolation

5. **Test Reporting** (`reporting/`)
   - Generates comprehensive test reports
   - Provides pass/fail status, coverage metrics, performance metrics
   - Formats reports as text, JSON, or HTML

6. **Fast-check Arbitraries** (`arbitraries/`)
   - Custom arbitraries for property-based testing
   - Ensures generated data respects all constraints

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Specific Phase
```bash
npm test -- tests/e2e/phases/webhook-ingestion.test.ts
```

### Run with Coverage
```bash
npm test -- --coverage
```

### Run Property Tests Only
```bash
npm test -- --testNamePattern="Property"
```

### Run Unit Tests Only
```bash
npm test -- --testNamePattern="should"
```

## Adding New Tests

### 1. Create Test File

Create a new test file in `tests/e2e/phases/`:

```typescript
import { TestOrchestratorImpl } from '../orchestration/test-orchestrator-impl';
import { DefaultWebhookGenerator } from '../generators/webhook-generator-impl';

describe('Phase X: Your Phase Name', () => {
  let orchestrator: TestOrchestratorImpl;
  let webhookGenerator: DefaultWebhookGenerator;

  beforeEach(() => {
    orchestrator = new TestOrchestratorImpl();
    webhookGenerator = new DefaultWebhookGenerator();
  });

  // Add your tests here
});
```

### 2. Implement Property Tests

Use fast-check for property-based testing:

```typescript
it('should validate property X', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
        // Add more parameters
      }),
      async (scenario) => {
        const context = await orchestrator.setupTest({
          isolatedEnvironment: true,
          featureFlags: { engineB: true },
          mockExternalAPIs: true,
          captureAllLogs: true
        });

        try {
          // Generate and inject data
          const webhook = webhookGenerator.generateWebhook({
            ...scenario,
            price: 450.00,
            volume: 1000000,
            timestamp: Date.now()
          });

          await orchestrator.injectWebhook(context, webhook);
          await new Promise(resolve => setTimeout(resolve, 100));

          // Capture and validate
          const state = await orchestrator.captureState(context);
          const result = validateYourProperty(state, expectation);

          expect(result.passed).toBe(true);
        } finally {
          await orchestrator.teardownTest(context);
        }
      }
    ),
    { numRuns: 100, seed: YOUR_SEED }
  );
});
```

### 3. Implement Unit Tests

Add specific scenario tests:

```typescript
it('should handle specific scenario', async () => {
  const context = await orchestrator.setupTest({
    isolatedEnvironment: true,
    featureFlags: { engineB: true },
    mockExternalAPIs: true,
    captureAllLogs: true
  });

  try {
    // Test specific scenario
    const webhook = webhookGenerator.generateWebhook({
      symbol: 'SPY',
      timeframe: '5m',
      session: 'RTH_OPEN',
      pattern: 'ORB_BREAKOUT',
      price: 450.00,
      volume: 1000000,
      timestamp: Date.now()
    });

    await orchestrator.injectWebhook(context, webhook);
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = await orchestrator.captureState(context);

    // Add assertions
    expect(state.webhookProcessingCount).toBe(1);
  } finally {
    await orchestrator.teardownTest(context);
  }
});
```

## Updating Baselines

### Capture New Baseline

For Engine A regression tests, capture a new baseline:

```typescript
const baseline = {
  scenarios: testScenarios,
  decisions: capturedDecisions,
  latencies: capturedLatencies,
  capturedAt: Date.now()
};

fs.writeFileSync(
  'tests/e2e/config/baselines.json',
  JSON.stringify(baseline, null, 2)
);
```

### Update Baseline

1. Run baseline capture script
2. Review captured baseline
3. Commit updated baseline to version control

## Interpreting Test Reports

### Text Report

```
================================================================================
E2E TEST REPORT
================================================================================

Generated: 2024-01-15T10:30:00.000Z
Status: ✓ PASSED

SUMMARY
--------------------------------------------------------------------------------
✓ All 150 tests passed. Coverage: 100.0% requirements, 100.0% properties.
Total Tests: 150
Passed: 150
Failed: 0
Skipped: 0

COVERAGE
--------------------------------------------------------------------------------
Requirements: 15/15 (100.0%)
Properties: 30/30 (100.0%)

PERFORMANCE
--------------------------------------------------------------------------------
Average Latency: 45.23ms
P50 Latency: 42.10ms
P95 Latency: 78.50ms
P99 Latency: 95.20ms
Total Execution Time: 125.45s
```

### Key Metrics

- **Overall Status**: Pass/fail for entire test suite
- **Coverage**: Percentage of requirements and properties tested
- **Performance**: Latency measurements (average, P50, P95, P99)
- **Determinism**: Whether multiple runs produce identical results
- **Failures**: Detailed information about any test failures

### Failure Information

When tests fail, the report includes:
- Test name and phase
- Requirement being validated
- Expected vs actual values
- Reproduction steps with synthetic data
- Stack trace (if available)

## Best Practices

### 1. Use Deterministic Seeds

Always use unique seeds for reproducibility:

```typescript
{ numRuns: 100, seed: 42 }
```

### 2. Isolate Tests

Always use isolated test environments:

```typescript
const context = await orchestrator.setupTest({
  isolatedEnvironment: true,
  mockExternalAPIs: true
});
```

### 3. Clean Up Resources

Always use try/finally for cleanup:

```typescript
try {
  // Test code
} finally {
  await orchestrator.teardownTest(context);
}
```

### 4. Mark Synthetic Data

All synthetic data must be marked:

```typescript
{
  payload: webhookPayload,
  metadata: {
    synthetic: true,
    scenario: scenario,
    generatedAt: Date.now()
  }
}
```

### 5. Test Incrementally

Start with one property test, verify it passes, then add more.

### 6. Use Validators

Don't write custom validation logic. Use the validation framework:

```typescript
import { validateWebhookIngestion } from '../validation/webhook-ingestion-validator';

const result = validateWebhookIngestion(state, expectation);
expect(result.passed).toBe(true);
```

### 7. Document Properties

Clearly document what each property tests:

```typescript
/**
 * Property 5: Webhook Processing Idempotency
 * 
 * For any webhook W, if W is sent N times (N > 1):
 * - The system processes W exactly once
 * - Subsequent sends are deduplicated
 * 
 * Validates: Requirements 3.1, 3.2
 */
```

## Troubleshooting

### Tests Timing Out

- Increase timeout in test config
- Check if system is processing webhooks
- Verify mock APIs are responding

### Property Tests Failing

- Check seed for reproducibility
- Verify validator expectations
- Review error details in console
- Reduce numRuns for debugging

### State Capture Issues

- Ensure sufficient wait time after injection
- Check if orchestrator is connected
- Verify system is running

### Validation Failures

- Review expected vs actual in error details
- Check if validator is appropriate for phase
- Verify test data matches expectations

## Configuration

### Test Configuration

Located in `tests/e2e/config/test-config.ts`:

```typescript
export const testConfig = {
  defaultTimeout: 30000,
  isolatedEnvironment: true,
  mockExternalAPIs: true,
  captureAllLogs: true
};
```

### Environment Configuration

Located in `tests/e2e/config/environments.json`:

```json
{
  "test": {
    "databaseUrl": "postgresql://test:test@localhost:5432/test_db",
    "brokerApiKey": "TEST_KEY",
    "mockAPIs": true
  }
}
```

### Baseline Configuration

Located in `tests/e2e/config/baselines.json`:

```json
{
  "engineA": {
    "scenarios": [...],
    "decisions": [...],
    "latencies": [...],
    "capturedAt": 1234567890
  }
}
```

## Requirements Coverage

The test system validates all 15 requirements:

1. ✅ Webhook Generation (1.1-1.10)
2. ✅ GEX Generation (2.1-2.10)
3. ✅ Webhook Ingestion (3.1-3.4)
4. ✅ Strategy Routing (4.1-4.5)
5. ✅ Engine A Regression (5.1-5.5)
6. ✅ Engine B Multi-Agent (6.1-6.9)
7. ✅ Risk Veto (7.1-7.3)
8. ✅ Shadow Execution (8.1-8.5)
9. ✅ Strategy Interaction (9.1-9.5)
10. ✅ GEX Regime Sensitivity (10.1-10.5)
11. ✅ Logging and Attribution (11.1-11.9)
12. ✅ Feature Flags (12.1-12.5)
13. ✅ Determinism (13.1-13.5)
14. ✅ Safety and Isolation (14.1-14.5)
15. ✅ Test Reporting (15.1-15.6)

## Property Coverage

The test system validates all 30 properties:

- Properties 1-4: Synthetic data generation
- Properties 5-7: Webhook ingestion
- Properties 8-10: Strategy routing
- Properties 11-13: Engine A regression
- Properties 14-16: Engine B multi-agent
- Property 17: Risk veto
- Property 18: Shadow execution
- Property 19: Strategy interaction
- Properties 20-21: GEX regime
- Properties 22-23: Logging
- Property 24: Feature flags
- Properties 25-27: Determinism
- Property 28: Safety
- Properties 29-30: Test reporting

## Support

For questions or issues:
1. Review this documentation
2. Check the implementation guide: `tests/e2e/IMPLEMENTATION_GUIDE.md`
3. Review phase templates: `tests/e2e/PHASE_TEMPLATE.md`
4. Check design document: `.kiro/specs/e2e-testing-with-synthetic-data/design.md`

## License

This testing system is part of the dual-engine options trading platform.
