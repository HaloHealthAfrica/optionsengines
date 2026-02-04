#!/usr/bin/env node
/**
 * E2E Test System CLI
 * 
 * Command-line interface for running E2E tests with various configurations.
 * 
 * Usage:
 *   npm run test:e2e                    # Run all tests with default config
 *   npm run test:e2e -- --env=staging   # Run tests in staging environment
 *   npm run test:e2e -- --scenario=regression  # Run regression tests
 *   npm run test:e2e -- --phase=5       # Run specific phase
 *   npm run test:e2e -- --engine-a      # Run Engine A regression tests
 *   npm run test:e2e -- --engine-b      # Run Engine B tests
 *   npm run test:e2e -- --ci            # Run CI tests
 *   npm run test:e2e -- --nightly       # Run nightly extended tests
 */

import { createE2ETestSystem } from './index';
import {
  Environment,
  TestScenario,
  createScenarioConfig,
  createEngineARegressionConfig,
  createEngineBTestConfig,
  createFeatureFlagTestConfig,
  createCIConfig,
  createNightlyConfig,
  loadConfigFromEnv,
  validateConfig,
} from './config';
import { TestRunnerConfig } from './test-runner';

/**
 * Parse command line arguments
 */
function parseArgs(): {
  env?: Environment;
  scenario?: TestScenario;
  phase?: number;
  engineA?: boolean;
  engineB?: boolean;
  featureFlags?: boolean;
  ci?: boolean;
  nightly?: boolean;
  stopOnFailure?: boolean;
  skipCheckpoints?: boolean;
  iterations?: number;
  help?: boolean;
} {
  const args = process.argv.slice(2);
  const parsed: any = {};
  
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg.startsWith('--env=')) {
      parsed.env = arg.split('=')[1] as Environment;
    } else if (arg.startsWith('--scenario=')) {
      parsed.scenario = arg.split('=')[1] as TestScenario;
    } else if (arg.startsWith('--phase=')) {
      parsed.phase = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--engine-a') {
      parsed.engineA = true;
    } else if (arg === '--engine-b') {
      parsed.engineB = true;
    } else if (arg === '--feature-flags') {
      parsed.featureFlags = true;
    } else if (arg === '--ci') {
      parsed.ci = true;
    } else if (arg === '--nightly') {
      parsed.nightly = true;
    } else if (arg === '--stop-on-failure') {
      parsed.stopOnFailure = true;
    } else if (arg === '--skip-checkpoints') {
      parsed.skipCheckpoints = true;
    } else if (arg.startsWith('--iterations=')) {
      parsed.iterations = parseInt(arg.split('=')[1], 10);
    }
  }
  
  return parsed;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
E2E Test System CLI

Usage:
  npm run test:e2e [options]

Options:
  --help, -h              Show this help message
  --env=<environment>     Run tests in specific environment (test, development, staging)
  --scenario=<scenario>   Run tests for specific scenario (unit, integration, e2e, regression, performance, determinism, safety)
  --phase=<number>        Run specific test phase by number
  --engine-a              Run Engine A regression tests
  --engine-b              Run Engine B tests
  --feature-flags         Run feature flag tests
  --ci                    Run CI/CD tests
  --nightly               Run nightly extended tests
  --stop-on-failure       Stop execution on first failure
  --skip-checkpoints      Skip checkpoint phases
  --iterations=<number>   Number of property test iterations

Examples:
  npm run test:e2e
  npm run test:e2e -- --env=staging
  npm run test:e2e -- --scenario=regression
  npm run test:e2e -- --phase=5
  npm run test:e2e -- --engine-a
  npm run test:e2e -- --ci --stop-on-failure
  npm run test:e2e -- --nightly --iterations=1000
`);
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const args = parseArgs();
  
  // Show help if requested
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  
  console.log('🚀 E2E Test System CLI\n');
  
  // Create test system
  const system = createE2ETestSystem();
  
  // Determine configuration
  let config: TestRunnerConfig;
  
  if (args.engineA) {
    console.log('📋 Running Engine A regression tests\n');
    config = createEngineARegressionConfig();
  } else if (args.engineB) {
    console.log('📋 Running Engine B tests\n');
    config = createEngineBTestConfig();
  } else if (args.featureFlags) {
    console.log('📋 Running feature flag tests\n');
    config = createFeatureFlagTestConfig();
  } else if (args.ci) {
    console.log('📋 Running CI/CD tests\n');
    config = createCIConfig();
  } else if (args.nightly) {
    console.log('📋 Running nightly extended tests\n');
    config = createNightlyConfig();
  } else if (args.env || args.scenario) {
    const env = args.env || 'test';
    const scenario = args.scenario || 'e2e';
    console.log(`📋 Running ${scenario} tests in ${env} environment\n`);
    config = createScenarioConfig(scenario, env);
  } else {
    console.log('📋 Running all tests with default configuration\n');
    config = loadConfigFromEnv();
  }
  
  // Apply command-line overrides
  if (args.stopOnFailure !== undefined) {
    config.stopOnFailure = args.stopOnFailure;
  }
  
  if (args.skipCheckpoints !== undefined) {
    config.skipCheckpoints = args.skipCheckpoints;
  }
  
  if (args.iterations !== undefined) {
    config.propertyTestIterations = args.iterations;
  }
  
  // Validate configuration
  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('❌ Configuration validation failed:\n');
    for (const error of validation.errors) {
      console.error(`   - ${error}`);
    }
    process.exit(1);
  }
  
  try {
    // Run tests
    let summary;
    
    if (args.phase !== undefined) {
      console.log(`📋 Running Phase ${args.phase}\n`);
      const result = await system.runPhase(args.phase, config);
      
      // Print result
      const icon = result.passed ? '✅' : '❌';
      const status = result.passed ? 'PASSED' : 'FAILED';
      console.log(`\n${icon} Phase ${result.phase.phaseNumber}: ${status}`);
      
      process.exit(result.passed ? 0 : 1);
    } else {
      summary = await system.runAllTestsWithConfig(config);
      
      // Exit with appropriate code
      process.exit(summary.success ? 0 : 1);
    }
  } catch (error) {
    console.error('\n❌ Test execution failed with error:\n');
    console.error(error);
    process.exit(1);
  }
}

// Run CLI
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
