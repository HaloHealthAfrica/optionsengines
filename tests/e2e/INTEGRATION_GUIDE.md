# E2E Testing System - Integration Guide

## Overview

This guide explains how all components of the E2E testing system are wired together and how to use the integrated system.

## Architecture

The E2E testing system consists of four main layers:

### 1. Data Generation Layer
- **Webhook Generator**: Creates synthetic TradingView webhook payloads
- **GEX Generator**: Creates synthetic gamma exposure data
- **Location**: `tests/e2e/generators/`

### 2. Orchestration Layer
- **Test Orchestrator**: Coordinates test execution, data injection, and state capture
- **Location**: `tests/e2e/orchestration/`

### 3. Validation Layer
- **Validation Framework**: Verifies system behavior against expected outcomes
- **Location**: `tests/e2e/validation/` (to be implemented)

### 4. Execution Layer
- **Test Runner**: Orchestrates phase execution and reporting
- **Test Phases**: Individual test suites for each requirement area
- **Location**: `tests/e2e/test-runner.ts`, `tests/e2e/phases/`

## Component Wiring

### Data Flow

```
┌─────────────────┐
│   CLI / API     │
└────────┬────────┘
         │
         v
┌─────────────────┐
│   Test Runner   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Orchestrator   │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    v         v
┌────────┐ ┌────────┐
│Webhook │ │  GEX   │
│  Gen   │ │  Gen   │
└────────┘ └────────┘
    │         │
    └────┬────┘
         │
         v
┌─────────────────┐
│ System Under    │
│     Test        │
└────────┬────────┘
         │
         v
┌─────────────────┐
│   Validation    │
│   Framework     │
└────────┬────────┘
         │
         v
┌─────────────────┐
│    Reporting    │
└─────────────────┘
```

### Integration Points

#### 1. Generators → Orchestrator
```typescript
import { createWebhookGenerator, createGEXGenerator } from './generators';
import { createTestOrchestrator } from './orchestration/test-orchestrator-impl';

const webhookGen = createWebhookGenerator();
const gexGen = createGEXGenerator();
const orchestrator = createTestOrchestrator();

// Generate synthetic data
const webhook = webhookGen.generateWebhook(scenario);
const gex = gexGen.generateGEX(regime);

// Inject into system under test
await orchestrator.injectWebhook(context, webhook);
await orchestrator.injectGEX(context, gex);
```

#### 2. Orchestrator → Validation Framework
```typescript
// Capture system state
const state = await orchestrator.captureState(context);

// Validate behavior
const result = validationFramework.validateWebhookIngestion(state, expected);
```

#### 3. Test Runner → All Components
```typescript
import { createTestRunner } from './test-runner';
import { createDefaultConfig } from './test-runner';

const runner = createTestRunner();
const config = createDefaultConfig();

// Runner coordinates all components
const summary = await runner.runAllPhases(config);
```

## Usage

### Quick Start

```bash
# Run all tests with default configuration
npm run test:e2e

# Run Engine A regression tests
npm run test:e2e:engine-a

# Run Engine B tests
npm run test:e2e:engine-b

# Run CI tests
npm run test:e2e:ci

# Run nightly extended tests
npm run test:e2e:nightly
```

### Programmatic Usage

```typescript
import { createE2ETestSystem } from './tests/e2e';

// Create system instance
const system = createE2ETestSystem();

// Run all tests
const summary = await system.runAllTests();

// Run specific phase
const result = await system.runPhase(5);

// Run Engine A regression
const engineASummary = await system.runEngineARegression();

// Run Engine B tests
const engineBSummary = await system.runEngineBTests();
```

### Custom Configuration

```typescript
import { 
  createE2ETestSystem,
  createScenarioConfig,
  createDefaultFeatureFlags,
  featureFlagsToEnvVars
} from './tests/e2e';

const system = createE2ETestSystem();

// Create custom configuration
const config = createScenarioConfig('e2e', 'test');
config.propertyTestIterations = 200;
config.stopOnFailure = true;

// Customize feature flags
const flags = createDefaultFeatureFlags();
flags.ENGINE_B_ENABLED = false;
config.testConfig.featureFlags = featureFlagsToEnvVars(flags);

// Run with custom config
const summary = await system.runAllTestsWithConfig(config);
```

## Configuration

### Environment Configuration

Configuration files are located in `tests/e2e/config/`:

- `test-config.ts`: TypeScript configuration utilities
- `environments.json`: Environment-specific settings
- `baselines.json`: Baseline data for regression testing

### Feature Flags

Feature flags control which components are enabled during testing:

```typescript
{
  ENGINE_B_ENABLED: true,
  AGENT_ORB_ENABLED: true,
  AGENT_STRAT_ENABLED: true,
  AGENT_TTM_ENABLED: true,
  AGENT_SATYLAND_ENABLED: true,
  AGENT_RISK_ENABLED: true,
  AGENT_META_ENABLED: true,
  SHADOW_EXECUTION_ENABLED: true,
  GEX_REGIME_ENABLED: true,
  FRONTEND_DISPLAY_ENABLED: true
}
```

### Test Scenarios

Pre-configured scenarios for common testing workflows:

- `unit`: Fast unit tests with minimal iterations
- `integration`: Integration tests with standard iterations
- `e2e`: Full end-to-end tests
- `regression`: Regression tests with extended iterations
- `performance`: Performance tests with load testing
- `determinism`: Determinism validation with multiple runs
- `safety`: Safety and isolation tests

## Test Phases

The test runner executes tests in phases:

1. **Synthetic Data Generation** - Validate generators
2. **Checkpoint - Verify Generators** - Ensure generators work
3. **Webhook Ingestion** - Validate ingestion behavior
4. **Strategy Router** - Validate A/B routing
5. **Engine A Regression** - Ensure no Engine A changes
6. **Checkpoint - Verify Engine A** - Verify regression prevention
7. **Engine B Multi-Agent** - Validate multi-agent system
8. **Risk Veto** - Validate risk veto functionality
9. **Shadow Execution** - Validate shadow execution isolation
10. **Checkpoint - Verify Engine B** - Verify Engine B works
11. **Strategy Interaction** - Validate agent interactions
12. **GEX Regime** - Validate GEX regime sensitivity
13. **Logging and Attribution** - Validate logging completeness
14. **Feature Flags** - Validate feature flag behavior
15. **Checkpoint - Verify All Phases** - Verify all tests pass
16. **Determinism and Replay** - Validate deterministic behavior
17. **Safety and Isolation** - Validate production safety
18. **Integration** - Validate end-to-end integration
19. **Final Checkpoint** - Final verification

## Error Handling

The system provides comprehensive error handling:

### Test Execution Errors
- Captured and reported with detailed context
- Option to stop on first failure or continue
- Checkpoint failures trigger warnings

### Configuration Errors
- Validated before test execution
- Clear error messages for invalid configurations
- Prevents running tests in production environment

### Safety Violations
- Immediate halt on broker API calls
- Immediate halt on production data modification
- Critical alerts for safety violations

## Reporting

Test reports include:

- Pass/fail status for all phases
- Requirements coverage metrics
- Properties coverage metrics
- Performance metrics
- Detailed failure information
- Reproduction steps for failures

Reports are generated in the configured output directory (default: `./test-reports`).

## Extension Points

### Adding New Test Phases

1. Create test suite file in `tests/e2e/phases/`
2. Add phase definition to `test-runner.ts`
3. Implement test cases using generators and orchestrator
4. Add validation using validation framework

### Adding New Generators

1. Define generator interface in `tests/e2e/generators/`
2. Implement generator with synthetic data marking
3. Add property tests for generator
4. Export from `tests/e2e/generators/index.ts`

### Adding New Validators

1. Define validator interface in `tests/e2e/validation/`
2. Implement validation logic
3. Add unit tests for validator
4. Integrate with test phases

## Best Practices

1. **Always use synthetic data marking**: Ensure all generated data has `synthetic: true`
2. **Use isolated environments**: Never run tests against production
3. **Mock external APIs**: Prevent live API calls during testing
4. **Validate configurations**: Use `validateConfig()` before running tests
5. **Use checkpoints**: Don't skip checkpoints in critical test runs
6. **Review failures**: Investigate all test failures before proceeding
7. **Update baselines**: Keep Engine A baselines up to date
8. **Run extended tests**: Use nightly tests for comprehensive validation

## Troubleshooting

### Tests Fail to Start
- Check configuration validation errors
- Verify environment variables are set
- Ensure test database is accessible

### Synthetic Data Not Marked
- Verify generators are using latest implementation
- Check that `metadata.synthetic` is set to `true`

### API Mocking Not Working
- Verify `mockExternalAPIs` is set to `true`
- Check nock configuration in orchestrator
- Ensure API URLs match mock patterns

### Performance Issues
- Reduce `propertyTestIterations` for faster runs
- Skip checkpoints for quick validation
- Run specific phases instead of all phases

## Support

For issues or questions:
1. Check this integration guide
2. Review test phase documentation
3. Check configuration examples
4. Review error messages and logs
