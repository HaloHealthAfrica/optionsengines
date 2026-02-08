/**
 * Orchestrator container - wires core components
 */

import pg from 'pg';
import { config } from '../config/index.js';
import { EngineCoordinator, EngineInvoker } from './engine-coordinator.js';
import { ExperimentManager } from './experiment-manager.js';
import { OrchestratorService } from './orchestrator-service.js';
import { OutcomeTracker } from './outcome-tracker.js';
import { PolicyEngine } from './policy-engine.js';
import { SignalProcessor } from './signal-processor.js';
import { ShadowExecutor } from '../services/shadow-executor.service.js';

const { Pool } = pg;

export function createOrchestratorService(invokers: {
  engineA: EngineInvoker;
  engineB: EngineInvoker;
}): OrchestratorService {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
  });

  const signalProcessor = new SignalProcessor(pool);
  const experimentManager = new ExperimentManager(pool);
  const policyEngine = new PolicyEngine(pool);
  const engineCoordinator = new EngineCoordinator(invokers.engineA, invokers.engineB);
  const outcomeTracker = new OutcomeTracker(pool);
  const shadowExecutor = new ShadowExecutor();

  return new OrchestratorService(
    signalProcessor,
    experimentManager,
    policyEngine,
    engineCoordinator,
    outcomeTracker,
    shadowExecutor
  );
}
