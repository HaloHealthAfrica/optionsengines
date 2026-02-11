import { logger } from './logger.js';
import { config } from '../config/index.js';

type ConfigSummary = {
  port: number;
  nodeEnv: string;
  appMode: string;
  databaseUrl: string;
  marketDataProvider: string;
  alpacaPaper: boolean;
  alpacaBaseUrl: string;
  polygonBaseUrl: string;
  slowRequestMs: number;
  cacheTtlSeconds: number;
  alpacaRateLimit: number;
  twelveDataRateLimit: number;
  polygonRateLimit: number;
  polygonWsEnabled: boolean;
  signalProcessorInterval: number;
  orderCreatorInterval: number;
  paperExecutorInterval: number;
  paperExecutorBatchSize: number;
  positionRefresherInterval: number;
  exitMonitorInterval: number;
  maxPositionSize: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
  maxExposurePercent: number;
  maxDailyTrades: number;
  positionReplacementEnabled: boolean;
  minConfidenceForReplacement: number;
  autoCloseNearTarget: boolean;
  autoCloseNearTargetThresholdPct: number;
  closeAgedPositions: boolean;
  closeAgedAfterHours: number;
  closeAgedBelowPnlPercent: number;
  profitTargetPct: number;
  stopLossPct: number;
  timeStopDte: number;
  maxHoldDays: number;
  abSplitPercentage: number;
  enableVariantB: boolean;
  enableOrchestrator: boolean;
  enableDualPaperTrading: boolean;
  enableMarketWebhookPipeline: boolean;
  orchestratorBatchSize: number;
  orchestratorConcurrency: number;
  orchestratorSignalTimeoutMs: number;
  orchestratorRetryDelayMs: number;
  processingQueueDepthAlert: number;
  processingQueueDepthDurationSec: number;
};

function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '***';
  }
}

export function logConfigSummary(summary: ConfigSummary = config): void {
  logger.info('Startup configuration', {
    port: summary.port,
    nodeEnv: summary.nodeEnv,
    appMode: summary.appMode,
    databaseUrl: maskDatabaseUrl(summary.databaseUrl),
    marketDataProvider: summary.marketDataProvider,
    alpacaPaper: summary.alpacaPaper,
    alpacaBaseUrl: summary.alpacaBaseUrl,
    polygonBaseUrl: summary.polygonBaseUrl,
    slowRequestMs: summary.slowRequestMs,
    cacheTtlSeconds: summary.cacheTtlSeconds,
    alpacaRateLimit: summary.alpacaRateLimit,
    twelveDataRateLimit: summary.twelveDataRateLimit,
    polygonRateLimit: summary.polygonRateLimit,
    polygonWsEnabled: summary.polygonWsEnabled,
    workerIntervals: {
      signalProcessorInterval: summary.signalProcessorInterval,
      orderCreatorInterval: summary.orderCreatorInterval,
      paperExecutorInterval: summary.paperExecutorInterval,
      paperExecutorBatchSize: summary.paperExecutorBatchSize,
      positionRefresherInterval: summary.positionRefresherInterval,
      exitMonitorInterval: summary.exitMonitorInterval,
    },
    riskLimits: {
      maxPositionSize: summary.maxPositionSize,
      maxDailyLoss: summary.maxDailyLoss,
      maxOpenPositions: summary.maxOpenPositions,
      maxExposurePercent: summary.maxExposurePercent,
      maxDailyTrades: summary.maxDailyTrades,
      positionReplacementEnabled: summary.positionReplacementEnabled,
      minConfidenceForReplacement: summary.minConfidenceForReplacement,
      autoCloseNearTarget: summary.autoCloseNearTarget,
      autoCloseNearTargetThresholdPct: summary.autoCloseNearTargetThresholdPct,
      closeAgedPositions: summary.closeAgedPositions,
      closeAgedAfterHours: summary.closeAgedAfterHours,
      closeAgedBelowPnlPercent: summary.closeAgedBelowPnlPercent,
    },
    exitRules: {
      profitTargetPct: summary.profitTargetPct,
      stopLossPct: summary.stopLossPct,
      timeStopDte: summary.timeStopDte,
      maxHoldDays: summary.maxHoldDays,
    },
    abTesting: {
      abSplitPercentage: summary.abSplitPercentage,
      enableVariantB: summary.enableVariantB,
    },
    orchestrator: {
      enableOrchestrator: summary.enableOrchestrator,
      enableDualPaperTrading: summary.enableDualPaperTrading,
      orchestratorBatchSize: summary.orchestratorBatchSize,
      orchestratorConcurrency: summary.orchestratorConcurrency,
      orchestratorSignalTimeoutMs: summary.orchestratorSignalTimeoutMs,
      orchestratorRetryDelayMs: summary.orchestratorRetryDelayMs,
      processingQueueDepthAlert: summary.processingQueueDepthAlert,
      processingQueueDepthDurationSec: summary.processingQueueDepthDurationSec,
    },
    marketWebhooks: {
      enableMarketWebhookPipeline: summary.enableMarketWebhookPipeline,
    },
  });
}
