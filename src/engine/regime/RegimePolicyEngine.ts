import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import type { IVRegime, TermShape } from '../types/enums.js';

// ─── Rule DSL Types ───

export interface PolicyRule {
  when: RuleCondition;
  then: RuleOutput;
  priority?: number;
}

export interface RuleCondition {
  ivRegime?: string;
  ivRegimeIn?: string[];
  termShape?: string;
  termShapeIn?: string[];
  skewAbove?: number;
  skewBelow?: number;
  ivPercentileAbove?: number;
  ivPercentileBelow?: number;
}

export interface RuleOutput {
  bucketLimits?: Record<string, number>;
  strategyWeights?: Record<string, number>;
  risk?: {
    globalSize?: number;
    maxTrades?: number;
  };
  denyStrategies?: string[];
  allowStrategies?: string[];
}

// ─── Allocation Snapshot Types ───

export interface AllocationSnapshot {
  id: string;
  accountId: string;
  computedAt: Date;
  underlying: string | null;
  regimeTag: string;
  bucketLimits: Record<string, number>;
  strategyWeightOverrides: Record<string, number>;
  riskMultipliers: Record<string, number>;
  denyStrategies: string[];
  confidence: number;
  source: string;
  notes: string | null;
}

export interface RegimeContext {
  ivRegime: IVRegime;
  termShape: TermShape;
  ivPercentile: number | null;
  skew: number | null;
}

export interface AllocationPolicy {
  id: string;
  accountId: string;
  policyVersion: string;
  enabled: boolean;
  rules: PolicyRule[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Module 4: Regime-Based Strategy Reallocation.
 * Evaluates policy rules against current regime context to produce
 * allocation overrides (bucket limits, strategy weights, risk multipliers).
 */
export class RegimePolicyEngine {

  /**
   * Evaluate all matching policy rules for an account given current regime.
   * Produces and persists an AllocationSnapshot.
   */
  async evaluate(
    accountId: string,
    context: RegimeContext,
    underlying?: string
  ): Promise<AllocationSnapshot> {
    const policy = await this.getActivePolicy(accountId);

    if (!policy || !policy.enabled || policy.rules.length === 0) {
      return this.buildDefaultSnapshot(accountId, context, underlying);
    }

    // Evaluate rules in priority order
    const sortedRules = [...policy.rules].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100)
    );

    const matchedRules: PolicyRule[] = [];
    for (const rule of sortedRules) {
      if (this.matchesCondition(rule.when, context)) {
        matchedRules.push(rule);
      }
    }

    if (matchedRules.length === 0) {
      return this.buildDefaultSnapshot(accountId, context, underlying);
    }

    // Merge matched rule outputs (later rules override earlier for conflicts)
    const merged = this.mergeOutputs(matchedRules.map(r => r.then));
    const regimeTag = this.buildRegimeTag(context);

    const snapshot = await this.persistSnapshot({
      accountId,
      underlying: underlying ?? null,
      regimeTag,
      bucketLimits: merged.bucketLimits ?? this.getDefaultBucketLimits(),
      strategyWeightOverrides: merged.strategyWeights ?? {},
      riskMultipliers: merged.risk ?? {},
      denyStrategies: merged.denyStrategies ?? [],
      confidence: this.computeConfidence(context),
      notes: `${matchedRules.length} rule(s) matched for ${regimeTag}`,
    });

    Sentry.addBreadcrumb({
      category: 'engine',
      message: `Policy evaluation: ${matchedRules.length} rule(s) matched for ${regimeTag}`,
      level: 'info',
      data: { accountId, regimeTag, matchedRules: matchedRules.length, denyStrategies: merged.denyStrategies ?? [] },
    });

    logger.info('Regime allocation computed', {
      accountId, regimeTag,
      matchedRules: matchedRules.length,
      denyStrategies: merged.denyStrategies?.length ?? 0,
    });

    return snapshot;
  }

  /**
   * Check if a strategy is allowed under current allocation.
   */
  isStrategyAllowed(strategyTag: string, snapshot: AllocationSnapshot): boolean {
    return !snapshot.denyStrategies.includes(strategyTag);
  }

  /**
   * Get effective weight multiplier for a strategy.
   */
  getStrategyWeight(strategyTag: string, snapshot: AllocationSnapshot): number {
    return snapshot.strategyWeightOverrides[strategyTag] ?? 1.0;
  }

  /**
   * Get global size multiplier from risk overrides.
   */
  getGlobalSizeMultiplier(snapshot: AllocationSnapshot): number {
    return snapshot.riskMultipliers['globalSize'] ?? 1.0;
  }

  /**
   * Get effective bucket limit for a strategy bucket.
   */
  getBucketLimit(bucketName: string, snapshot: AllocationSnapshot): number {
    return snapshot.bucketLimits[bucketName] ?? 0;
  }

  // ─── Policy CRUD ───

  async getActivePolicy(accountId: string): Promise<AllocationPolicy | null> {
    const result = await db.query(
      `SELECT * FROM oe_strategy_allocation_policies
       WHERE account_id = $1 AND enabled = true
       ORDER BY updated_at DESC LIMIT 1`,
      [accountId]
    );

    if (result.rows.length === 0) return null;
    return this.mapPolicyRow(result.rows[0]);
  }

  async createPolicy(
    accountId: string,
    rules: PolicyRule[],
    version: string = '1.0.0'
  ): Promise<AllocationPolicy> {
    const id = randomUUID();
    const now = new Date();

    await db.query(
      `INSERT INTO oe_strategy_allocation_policies
        (id, account_id, policy_version, enabled, rules, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, accountId, version, true, JSON.stringify(rules), now, now]
    );

    return {
      id, accountId, policyVersion: version,
      enabled: true, rules, createdAt: now, updatedAt: now,
    };
  }

  async updatePolicy(policyId: string, rules: PolicyRule[], version: string): Promise<void> {
    await db.query(
      `UPDATE oe_strategy_allocation_policies
       SET rules = $1, policy_version = $2, updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(rules), version, policyId]
    );
  }

  async disablePolicy(policyId: string): Promise<void> {
    await db.query(
      'UPDATE oe_strategy_allocation_policies SET enabled = false, updated_at = NOW() WHERE id = $1',
      [policyId]
    );
  }

  // ─── Snapshot Retrieval ───

  async getLatestSnapshot(accountId: string): Promise<AllocationSnapshot | null> {
    const result = await db.query(
      `SELECT * FROM oe_allocation_snapshots
       WHERE account_id = $1
       ORDER BY computed_at DESC LIMIT 1`,
      [accountId]
    );

    if (result.rows.length === 0) return null;
    return this.mapSnapshotRow(result.rows[0]);
  }

  // ─── Rule Matching ───

  matchesCondition(condition: RuleCondition, context: RegimeContext): boolean {
    if (condition.ivRegime && condition.ivRegime !== context.ivRegime) {
      return false;
    }

    if (condition.ivRegimeIn && !condition.ivRegimeIn.includes(context.ivRegime)) {
      return false;
    }

    if (condition.termShape && condition.termShape !== context.termShape) {
      return false;
    }

    if (condition.termShapeIn && !condition.termShapeIn.includes(context.termShape)) {
      return false;
    }

    if (condition.skewAbove !== undefined && (context.skew === null || context.skew <= condition.skewAbove)) {
      return false;
    }

    if (condition.skewBelow !== undefined && (context.skew === null || context.skew >= condition.skewBelow)) {
      return false;
    }

    if (condition.ivPercentileAbove !== undefined && (context.ivPercentile === null || context.ivPercentile <= condition.ivPercentileAbove)) {
      return false;
    }

    if (condition.ivPercentileBelow !== undefined && (context.ivPercentile === null || context.ivPercentile >= condition.ivPercentileBelow)) {
      return false;
    }

    return true;
  }

  // ─── Output Merging ───

  private mergeOutputs(outputs: RuleOutput[]): RuleOutput {
    const merged: RuleOutput = {};

    for (const output of outputs) {
      if (output.bucketLimits) {
        merged.bucketLimits = { ...(merged.bucketLimits ?? {}), ...output.bucketLimits };
      }
      if (output.strategyWeights) {
        merged.strategyWeights = { ...(merged.strategyWeights ?? {}), ...output.strategyWeights };
      }
      if (output.risk) {
        merged.risk = { ...(merged.risk ?? {}), ...output.risk };
      }
      if (output.denyStrategies) {
        const existing = new Set(merged.denyStrategies ?? []);
        for (const s of output.denyStrategies) existing.add(s);
        merged.denyStrategies = Array.from(existing);
      }
      if (output.allowStrategies) {
        merged.allowStrategies = output.allowStrategies;
      }
    }

    // allowStrategies overrides denyStrategies
    if (merged.allowStrategies && merged.denyStrategies) {
      merged.denyStrategies = merged.denyStrategies.filter(
        s => !merged.allowStrategies!.includes(s)
      );
    }

    return merged;
  }

  // ─── Helpers ───

  private buildRegimeTag(context: RegimeContext): string {
    return `${context.ivRegime}:${context.termShape}`;
  }

  private computeConfidence(context: RegimeContext): number {
    let confidence = 0.5;
    if (context.ivPercentile !== null) confidence += 0.25;
    if (context.skew !== null) confidence += 0.15;
    if (context.ivRegime !== 'UNKNOWN') confidence += 0.10;
    return Math.min(1, confidence);
  }

  private getDefaultBucketLimits(): Record<string, number> {
    return { ...getEngineConfig().buckets };
  }

  private async buildDefaultSnapshot(
    accountId: string,
    context: RegimeContext,
    underlying?: string
  ): Promise<AllocationSnapshot> {
    return this.persistSnapshot({
      accountId,
      underlying: underlying ?? null,
      regimeTag: this.buildRegimeTag(context),
      bucketLimits: this.getDefaultBucketLimits(),
      strategyWeightOverrides: {},
      riskMultipliers: {},
      denyStrategies: [],
      confidence: this.computeConfidence(context),
      notes: 'No matching policy rules; using defaults',
    });
  }

  private async persistSnapshot(params: {
    accountId: string;
    underlying: string | null;
    regimeTag: string;
    bucketLimits: Record<string, number>;
    strategyWeightOverrides: Record<string, number>;
    riskMultipliers: Record<string, number>;
    denyStrategies: string[];
    confidence: number;
    notes: string;
  }): Promise<AllocationSnapshot> {
    const id = randomUUID();
    const now = new Date();

    await db.query(
      `INSERT INTO oe_allocation_snapshots
        (id, account_id, computed_at, underlying, regime_tag,
         bucket_limits, strategy_weight_overrides, risk_multipliers,
         deny_strategies, confidence, source, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id, params.accountId, now, params.underlying, params.regimeTag,
        JSON.stringify(params.bucketLimits),
        JSON.stringify(params.strategyWeightOverrides),
        JSON.stringify(params.riskMultipliers),
        params.denyStrategies,
        params.confidence, 'COMPUTED', params.notes,
      ]
    );

    return {
      id, accountId: params.accountId, computedAt: now,
      underlying: params.underlying,
      regimeTag: params.regimeTag,
      bucketLimits: params.bucketLimits,
      strategyWeightOverrides: params.strategyWeightOverrides,
      riskMultipliers: params.riskMultipliers,
      denyStrategies: params.denyStrategies,
      confidence: params.confidence,
      source: 'COMPUTED',
      notes: params.notes,
    };
  }

  private mapPolicyRow(row: Record<string, unknown>): AllocationPolicy {
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      policyVersion: row.policy_version as string,
      enabled: row.enabled as boolean,
      rules: row.rules as PolicyRule[],
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapSnapshotRow(row: Record<string, unknown>): AllocationSnapshot {
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      computedAt: new Date(row.computed_at as string),
      underlying: row.underlying as string | null,
      regimeTag: row.regime_tag as string,
      bucketLimits: row.bucket_limits as Record<string, number>,
      strategyWeightOverrides: row.strategy_weight_overrides as Record<string, number>,
      riskMultipliers: row.risk_multipliers as Record<string, number>,
      denyStrategies: row.deny_strategies as string[],
      confidence: parseFloat(row.confidence as string),
      source: row.source as string,
      notes: row.notes as string | null,
    };
  }
}

export const regimePolicyEngine = new RegimePolicyEngine();
