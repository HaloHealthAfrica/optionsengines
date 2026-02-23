export { DashboardQueryService, dashboardQueryService } from './DashboardQueryService.js';
export type {
  PositionSummary,
  PnlSummary,
  RiskSnapshot,
  RegimeSummary,
  DashboardOverview,
  TraceSnapshot,
  StrategyDashboard,
} from './DashboardQueryService.js';

export { StrategyRollupService, strategyRollupService } from './StrategyRollupService.js';
export type { StrategyRollup, RegimeBucket, DteBucket, HourBucket } from './StrategyRollupService.js';

export { DriftDetectionEngine, driftDetectionEngine } from './DriftDetectionEngine.js';
export type { DriftEvent, DriftDetectionResult, DriftType, DriftSeverity } from './DriftDetectionEngine.js';

export { ContextPerformanceService, contextPerformanceService } from './ContextPerformanceService.js';
export type { ContextPerformanceRow, ContextBreakdown, ContextType } from './ContextPerformanceService.js';
