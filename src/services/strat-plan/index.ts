/**
 * Strat Plan Lifecycle Engine - Index
 * Focused tactical execution: max 10 tickers, controlled plan capacity
 */

export { watchlistManager } from './watchlist-manager.service.js';
export { stratPlanLifecycleService } from './strat-plan-lifecycle.service.js';
export { getStratPlanConfig, invalidateConfigCache } from './strat-plan-config.service.js';
export { planToSignalBridge } from './plan-to-signal-bridge.service.js';
export type {
  WatchlistEntry,
  WatchlistSource,
  StratPlan,
  StratPlanState,
  PlanSource,
  StratPlanConfig,
  PlanPrioritizationInput,
} from './types.js';
