# E2E Testing Implementation Guide

## Quick Start

This guide helps you implement the remaining E2E test phases using the completed Phase 1 as a reference.

## What's Complete

✅ **Infrastructure (100%)**
- Synthetic data generators (webhook & GEX)
- Test orchestrator with setup/teardown
- Complete validation framework
- Test environment configuration

✅ **Phase 1: Webhook Ingestion (100%)**
- 3 property tests with 100+ runs each
- 3 unit tests for edge cases
- Complete integration with orchestrator and validators
- **Location**: `tests/e2e/phases/webhook-ingestion.test.ts`

## Implementation Pattern

### Step 1: Copy the Template

```bash
cp tests/e2e/phases/webhook-ingestion.test.ts tests/e2e/phases/[new-phase].test.ts
```

### Step 2: Update Phase Information

```typescript
/**
 * Phase X: [Your Phase Name]
 * 
 * Tests [what this phase tests]
 * 
 * Requirements: [requirement numbers from design doc]
 */
```

### Step 3: Implement Property Tests

For each property in the design document:

1. **Define the Property**:
```typescript
/**
 * Property N: [Property Name]
 * 
 * [Mathematical or logical description]
 * 
 * Validates: Requirements [X.Y, X.Z]
 */
```

2. **Create Test Scenarios**:
```typescript
fc.record({
  // Define parameters that vary
  symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
  // Add phase-specific parameters
})
```

3. **Implement Test Logic**:
```typescript
// Setup → Generate → Inject → Wait → Capture → Validate → Assert
```

4. **Use Appropriate Validator**:
```typescript
import { validateRouting } from '../validation/routing-validator';
// or validateEngineA, validateEngineB, etc.
```

### Step 4: Add Unit Tests

For each edge case or specific scenario:

```typescript
it('should handle [specific scenario]', async () => {
  // Setup test context
  // Create specific test data
  // Execute test
  // Assert specific behavior
});
```

### Step 5: Run and Verify

```bash
npm test -- tests/e2e/phases/[new-phase].test.ts
```

## Phase-Specific Guidance

### Phase 2: Strategy Router
- **Focus**: Deterministic routing, variant distribution
- **Validator**: `validateRouting`
- **Key Data**: Router decisions, feature flags
- **Seeds**: 50-52

### Phase 3: Engine A Regression
- **Focus**: Behavioral and performance regression
- **Validator**: `validateEngineA`
- **Key Data**: Baseline decisions, latency
- **Seeds**: 60-62
- **Special**: Requires baseline capture first

### Phase 4: Engine B Multi-Agent
- **Focus**: Agent activation, data isolation
- **Validator**: `validateEngineB`
- **Key Data**: Agent activations, shadow executions
- **Seeds**: 70-72

### Phase 5: Risk Veto
- **Focus**: Veto enforcement, logging
- **Validator**: `validateRiskVeto`
- **Key Data**: Veto decisions, execution prevention
- **Seeds**: 80-81

### Phase 6: Shadow Execution
- **Focus**: Isolation, no broker API calls
- **Validator**: `validateShadowExecution`
- **Key Data**: Shadow trades, broker API calls
- **Seeds**: 90-91

### Phase 7: Strategy Interaction
- **Focus**: Multi-agent confidence adjustment
- **Validator**: `validateEngineB` (with confidence checks)
- **Key Data**: Agent outputs, confidence changes
- **Seeds**: 100-101

### Phase 8: GEX Regime
- **Focus**: Regime sensitivity, attribution
- **Validator**: `validateGEXRegime`
- **Key Data**: GEX data, agent behavior
- **Seeds**: 110-112
- **Special**: Use GEXGenerator

### Phase 9: Logging and Attribution
- **Focus**: Logging completeness, frontend consistency
- **Validator**: `validateLogging`, `validateFrontend`
- **Key Data**: Log entries, frontend state
- **Seeds**: 120-122

### Phase 10: Feature Flags
- **Focus**: Kill-switch behavior
- **Validator**: `validateFeatureFlag`
- **Key Data**: Feature flag states, routing
- **Seeds**: 130-131

### Phase 11: Determinism
- **Focus**: Identical outputs for identical inputs
- **Validator**: `validateDeterminism`
- **Key Data**: Multiple run states
- **Seeds**: 140-142
- **Special**: Run same test multiple times

### Phase 12: Safety
- **Focus**: Test isolation, production protection
- **Validator**: `validateShadowExecution` (safety aspects)
- **Key Data**: Broker API calls, production state
- **Seeds**: 150-151

## Common Patterns

### Pattern 1: Single Webhook Test
```typescript
const webhook = webhookGenerator.generate(scenario);
await orchestrator.injectWebhook(context, webhook);
await new Promise(resolve => setTimeout(resolve, 100));
const state = await orchestrator.captureState(context);
```

### Pattern 2: Multiple Webhooks Test
```typescript
const webhooks = scenarios.map(s => webhookGenerator.generate(s));
for (const webhook of webhooks) {
  await orchestrator.injectWebhook(context, webhook);
}
await new Promise(resolve => setTimeout(resolve, 200));
const state = await orchestrator.captureState(context);
```

### Pattern 3: GEX Data Test
```typescript
const gexData = gexGenerator.generate(scenario);
await orchestrator.injectGEX(context, gexData);
await new Promise(resolve => setTimeout(resolve, 100));
const state = await orchestrator.captureState(context);
```

### Pattern 4: Multi-Run Determinism Test
```typescript
const states: SystemState[] = [];
for (let i = 0; i < 3; i++) {
  const context = await orchestrator.setupTest(config);
  // ... inject same data
  const state = await orchestrator.captureState(context);
  states.push(state);
  await orchestrator.teardownTest(context);
}
const result = validateDeterminism(states);
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
- Ensure sufficient wait time
- Check if orchestrator is connected
- Verify system is running

### Validation Failures
- Review expected vs actual in error details
- Check if validator is appropriate for phase
- Verify test data matches expectations

## Best Practices

1. **Always Use Unique Seeds**: Ensures reproducibility
2. **Log Property Violations**: Include full error details
3. **Test Edge Cases**: Don't just test happy path
4. **Clean Up Resources**: Use try/finally for teardown
5. **Document Properties**: Clear mathematical descriptions
6. **Use Validators**: Don't write custom validation logic
7. **Test Incrementally**: Start with one property, then add more
8. **Review Design Doc**: Ensure properties match specifications

## Testing Checklist

For each phase:
- [ ] Property tests implemented (all from design doc)
- [ ] Unit tests for edge cases
- [ ] Proper setup/teardown
- [ ] Unique seeds for each property
- [ ] Appropriate validators used
- [ ] Error logging included
- [ ] Tests passing locally
- [ ] Documentation updated

## Getting Help

- **Reference**: `tests/e2e/phases/webhook-ingestion.test.ts`
- **Template**: `tests/e2e/phases/PHASE_TEMPLATE.md`
- **Validators**: `tests/e2e/validation/`
- **Design Doc**: `.kiro/specs/e2e-testing-with-synthetic-data/design.md`

## Next Phase to Implement

**Recommended Order**:
1. ✅ Phase 1: Webhook Ingestion (DONE)
2. Phase 2: Strategy Router (straightforward, good next step)
3. Phase 3: Engine A Regression (requires baseline)
4. Phase 4: Engine B Multi-Agent (builds on Phase 1)
5. Continue with remaining phases...

Start with Phase 2 using the webhook ingestion test as your template!
