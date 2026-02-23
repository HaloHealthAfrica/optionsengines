import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import * as Sentry from '@sentry/node';
import { getEngineConfig } from '../config/loader.js';
import { massiveOptionsService } from '../data/MassiveOptionsService.js';
import { dataSanityValidator } from '../data/DataSanityValidator.js';
import type { CandidateInput } from '../data/DataSanityValidator.js';
import type { OptionQuote } from '../data/MassiveOptionsService.js';
import {
  TradeStructure,
  TradeDirection,
  OptionRight,
  LegRole,
  RejectionCode,
  IVRegime,
} from '../types/enums.js';
import { OptionsEngineError } from '../types/errors.js';
import type {
  TradeIntent,
  TradePlan,
  TradePlanLeg,
  OptionCandidate,
  ConstructionRejection,
  CandidateCounts,
  MarketContext,
} from '../types/index.js';

const CONSTRUCTION_VERSION = '1.0.0';
const MIN_VIABLE_CANDIDATES = 3;

export interface ConstructionResult {
  success: boolean;
  tradePlan: TradePlan | null;
  rejection: ConstructionRejection | null;
}

export class OptionsConstructionEngine {

  async construct(
    intent: TradeIntent,
    marketContext: MarketContext
  ): Promise<ConstructionResult> {
    const startMs = performance.now();
    const cfg = getEngineConfig();

    try {
      // 1. Compute DTE window
      const today = new Date();
      const minDTE = Math.max(7, intent.targetDTE - intent.dteTolerance);
      const maxDTE = intent.targetDTE + intent.dteTolerance;
      const minExpiration = this.addDays(today, minDTE);
      const maxExpiration = this.addDays(today, maxDTE);

      // 2. Fetch chain from MassiveOptionsService
      const chainResult = await massiveOptionsService.getOptionsChain(intent.underlying, {
        expirationDateGte: this.formatDate(minExpiration),
        expirationDateLte: this.formatDate(maxExpiration),
      });

      // 3. Fetch snapshots for pricing/greeks
      const snapshotResult = await massiveOptionsService.getOptionsSnapshot(intent.underlying);

      // 4. Build snapshot lookup for fast join
      const quoteLookup = new Map<string, OptionQuote>();
      for (const q of snapshotResult.quotes) {
        quoteLookup.set(q.optionTicker, q);
      }

      // 5. Merge chain + snapshots into candidates
      const rawCandidates = this.buildCandidates(chainResult.contracts, quoteLookup, today, intent);
      const counts: CandidateCounts = {
        afterDTE: rawCandidates.length,
        afterDelta: 0,
        afterLiquidity: 0,
        afterSanity: 0,
        afterScoring: 0,
        afterRevalidation: 0,
      };

      // 6. Filter by delta range
      const deltaMin = intent.targetDelta - intent.deltaTolerance;
      const deltaMax = intent.targetDelta + intent.deltaTolerance;
      const afterDelta = rawCandidates.filter(c => {
        if (c.delta === null) return false;
        const absDelta = Math.abs(c.delta);
        return absDelta >= deltaMin && absDelta <= deltaMax;
      });
      counts.afterDelta = afterDelta.length;

      // 7. Filter by liquidity thresholds (OI, volume, spread width)
      const afterLiquidity = afterDelta.filter(c => {
        return c.oi >= cfg.liquidity.minOI
          && c.volume >= cfg.liquidity.minVolume
          && c.spreadWidthPct <= cfg.liquidity.maxSpreadWidthPct;
      });
      counts.afterLiquidity = afterLiquidity.length;

      // 8. Data sanity validation
      const underlyingSanity = dataSanityValidator.validateUnderlying({
        price: marketContext.underlyingPrice,
        priorClose: null,
      });

      if (!underlyingSanity.passed) {
        return this.buildRejection(
          [RejectionCode.UNDERLYING_PRICE_SANITY_FAILURE],
          counts, marketContext.underlyingPrice, startMs
        );
      }

      const afterSanity = afterLiquidity.filter(c => {
        const input: CandidateInput = {
          optionTicker: c.optionTicker,
          bid: c.bid,
          ask: c.ask,
          mid: c.mid,
          iv: c.iv,
          delta: c.delta,
          gamma: c.gamma,
          volume: c.volume,
          oi: c.oi,
          spreadWidthPct: c.spreadWidthPct,
          quoteTimestamp: c.quoteTimestamp,
          underlyingPrice: marketContext.underlyingPrice,
          greekSource: c.greekSource,
        };
        const result = dataSanityValidator.validateCandidate(input);
        c.sanityCheckPassed = result.passed;
        return result.passed;
      });
      counts.afterSanity = afterSanity.length;

      // 9. Compute scores for surviving candidates
      const scored = this.scoreCandidates(afterSanity, intent, marketContext);
      counts.afterScoring = scored.length;

      // 10. Check minimum viable candidates
      if (scored.length < MIN_VIABLE_CANDIDATES) {
        return this.buildRejection(
          [RejectionCode.INSUFFICIENT_CANDIDATES],
          counts, marketContext.underlyingPrice, startMs
        );
      }

      // 11. Filter by minimum liquidity score
      const afterLiqScore = scored.filter(c => c.liquidityScore >= cfg.liquidity.minLiquidityScore);
      counts.afterRevalidation = afterLiqScore.length;

      if (afterLiqScore.length < MIN_VIABLE_CANDIDATES) {
        return this.buildRejection(
          [RejectionCode.LOW_LIQUIDITY_SCORE],
          counts, marketContext.underlyingPrice, startMs
        );
      }

      // 12. Sort by totalScore descending
      afterLiqScore.sort((a, b) => b.totalScore - a.totalScore);

      // 13. Build TradePlan
      const isSpread = intent.structure === TradeStructure.CREDIT_CALL_SPREAD
        || intent.structure === TradeStructure.CREDIT_PUT_SPREAD;

      let tradePlan: TradePlan;
      if (isSpread) {
        tradePlan = this.buildSpreadPlan(afterLiqScore, intent, marketContext, cfg, startMs);
      } else {
        tradePlan = this.buildSingleLegPlan(afterLiqScore[0], intent, marketContext, cfg, startMs);
      }

      return { success: true, tradePlan, rejection: null };

    } catch (error) {
      if (error instanceof OptionsEngineError) throw error;
      logger.error('Construction engine failure', error as Error, { underlying: intent.underlying });
      Sentry.captureException(error, { tags: { service: 'OptionsConstructionEngine' } });
      throw error;
    }
  }

  // ─── Candidate Building ───

  private buildCandidates(
    contracts: Array<{ ticker: string; underlying_ticker: string; contract_type: string; expiration_date: string; strike_price: number }>,
    quoteLookup: Map<string, OptionQuote>,
    today: Date,
    intent: TradeIntent
  ): OptionCandidate[] {
    const candidates: OptionCandidate[] = [];
    const rightFilter = this.getTargetRight(intent.structure, intent.direction);

    for (const contract of contracts) {
      // Filter by option right (call/put)
      const contractRight = contract.contract_type === 'call' ? OptionRight.C : OptionRight.P;
      if (rightFilter !== null && contractRight !== rightFilter) continue;

      const quote = quoteLookup.get(contract.ticker);
      if (!quote) continue;

      const expDate = new Date(contract.expiration_date);
      const dte = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (dte < 7) continue; // hard floor

      const spreadWidth = quote.ask - quote.bid;
      const spreadWidthPct = quote.mid > 0 ? spreadWidth / quote.mid : Infinity;

      candidates.push({
        optionTicker: contract.ticker,
        expiration: contract.expiration_date,
        strike: contract.strike_price,
        right: contractRight,
        dte,
        delta: quote.delta,
        gamma: quote.gamma,
        vega: quote.vega,
        iv: quote.iv,
        greekSource: quote.greekSource,
        bid: quote.bid,
        ask: quote.ask,
        mid: quote.mid,
        volume: quote.volume,
        oi: quote.oi,
        spreadWidth,
        spreadWidthPct,
        liquidityScore: 0,
        quoteTimestamp: quote.quoteTimestamp,
        deltaScore: 0,
        dteScore: 0,
        ivContextScore: 0,
        totalScore: 0,
        sanityCheckPassed: false,
      });
    }

    return candidates;
  }

  // ─── Scoring ───

  scoreCandidates(
    candidates: OptionCandidate[],
    intent: TradeIntent,
    marketContext: MarketContext
  ): OptionCandidate[] {
    const cfg = getEngineConfig();

    for (const c of candidates) {
      c.liquidityScore = this.computeLiquidityScore(c, cfg.liquidity);
      c.deltaScore = this.computeDeltaScore(c, intent);
      c.dteScore = this.computeDTEScore(c, intent);
      c.ivContextScore = this.computeIVContextScore(marketContext);

      const raw = 0.40 * c.deltaScore
        + 0.25 * c.dteScore
        + 0.20 * c.liquidityScore
        + 0.15 * c.ivContextScore;

      c.totalScore = this.safeNumber(raw);
    }

    return candidates;
  }

  computeLiquidityScore(
    c: { volume: number; oi: number; spreadWidthPct: number },
    liqCfg: { volumeMaxRefDefault: number; oiMaxRefDefault: number }
  ): number {
    const volumeNorm = this.clamp(c.volume / liqCfg.volumeMaxRefDefault, 0, 1);
    const oiNorm = this.clamp(c.oi / liqCfg.oiMaxRefDefault, 0, 1);
    const spreadScore = this.clamp(1 - c.spreadWidthPct, 0, 1);

    const raw = 0.40 * volumeNorm + 0.30 * oiNorm + 0.30 * spreadScore;
    return this.safeNumber(raw);
  }

  computeDeltaScore(c: { delta: number | null }, intent: TradeIntent): number {
    if (c.delta === null) return 0;
    const diff = Math.abs(Math.abs(c.delta) - intent.targetDelta);
    if (intent.deltaTolerance === 0) return diff === 0 ? 1 : 0;
    const raw = 1 - diff / intent.deltaTolerance;
    return this.safeNumber(this.clamp(raw, 0, 1));
  }

  computeDTEScore(c: { dte: number }, intent: TradeIntent): number {
    const diff = Math.abs(c.dte - intent.targetDTE);
    if (intent.dteTolerance === 0) return diff === 0 ? 1 : 0;
    const raw = 1 - diff / intent.dteTolerance;
    return this.safeNumber(this.clamp(raw, 0, 1));
  }

  computeIVContextScore(marketContext: MarketContext): number {
    if (marketContext.ivRegime === IVRegime.UNKNOWN || marketContext.ivPercentile === null) {
      return 0.5;
    }
    return this.safeNumber(this.clamp(marketContext.ivPercentile, 0, 1));
  }

  // ─── Spread Construction ───

  computeSpreadRisk(
    shortLeg: OptionCandidate,
    longLeg: OptionCandidate
  ): { creditPerSpread: number; spreadWidthDollars: number; maxLossPerSpread: number } {
    const creditPerSpread = shortLeg.mid - longLeg.mid;
    const spreadWidthDollars = Math.abs(shortLeg.strike - longLeg.strike);
    const maxLossPerSpread = (spreadWidthDollars - creditPerSpread) * 100;

    return {
      creditPerSpread: this.safeNumber(creditPerSpread),
      spreadWidthDollars: this.safeNumber(spreadWidthDollars),
      maxLossPerSpread: this.safeNumber(maxLossPerSpread),
    };
  }

  private buildSpreadPlan(
    candidates: OptionCandidate[],
    intent: TradeIntent,
    marketContext: MarketContext,
    cfg: ReturnType<typeof getEngineConfig>,
    startMs: number
  ): TradePlan {
    // Short leg = best scored candidate (closest to target delta)
    const shortLeg = candidates[0];

    // Long leg = same expiration, further OTM, protection delta
    const protectionDelta = this.getProtectionDelta(intent);
    const longLeg = this.findProtectionLeg(candidates, shortLeg, protectionDelta, intent);

    if (!longLeg) {
      throw new OptionsEngineError(
        RejectionCode.INSUFFICIENT_CANDIDATES,
        'No suitable protection leg found for spread',
        { shortLeg: shortLeg.optionTicker, protectionDelta }
      );
    }

    const spreadRisk = this.computeSpreadRisk(shortLeg, longLeg);

    if (spreadRisk.creditPerSpread <= 0) {
      throw new OptionsEngineError(
        RejectionCode.BAD_SPREAD_CREDIT,
        `Credit spread has no credit: ${spreadRisk.creditPerSpread}`,
        { shortLeg: shortLeg.optionTicker, longLeg: longLeg.optionTicker }
      );
    }

    const minCredit = spreadRisk.spreadWidthDollars * cfg.liquidity.minCreditRatio;
    if (spreadRisk.creditPerSpread < minCredit) {
      throw new OptionsEngineError(
        RejectionCode.BAD_SPREAD_CREDIT,
        `Credit ${spreadRisk.creditPerSpread.toFixed(2)} < min ${minCredit.toFixed(2)} (${(cfg.liquidity.minCreditRatio * 100).toFixed(0)}% of width)`,
        { creditPerSpread: spreadRisk.creditPerSpread, minCredit, spreadWidth: spreadRisk.spreadWidthDollars }
      );
    }

    const maxContracts = Math.floor(intent.maxRiskPerTrade / spreadRisk.maxLossPerSpread);
    const contracts = Math.max(1, maxContracts);

    const legs: TradePlanLeg[] = [
      this.candidateToLeg(shortLeg, LegRole.SHORT),
      this.candidateToLeg(longLeg, LegRole.LONG),
    ];

    const elapsedMs = performance.now() - startMs;

    return {
      tradePlanId: randomUUID(),
      accountId: intent.accountId,
      strategyTag: intent.strategyTag,
      structure: intent.structure,
      underlying: intent.underlying,
      contracts,
      legs,
      entryModel: {
        expectedPrice: spreadRisk.creditPerSpread,
        limitPrice: spreadRisk.creditPerSpread * 0.95,
        maxRepricingAttempts: cfg.slippage.repriceAttempts,
        repriceIntervalSeconds: cfg.slippage.repriceIntervalSeconds,
      },
      exitModel: {
        profitTargetPct: cfg.exits.creditSpread.profitTargetPct,
        stopLossPct: cfg.exits.creditSpread.stopLossPct,
        maxHoldDays: shortLeg.dte - 1,
      },
      riskModel: {
        maxLossPerContract: spreadRisk.maxLossPerSpread,
        maxLossTotal: spreadRisk.maxLossPerSpread * contracts,
        creditPerSpread: spreadRisk.creditPerSpread,
        spreadWidthDollars: spreadRisk.spreadWidthDollars,
      },
      liquidityModel: {
        liquidityScore: Math.min(shortLeg.liquidityScore, longLeg.liquidityScore),
        spreadWidthPct: Math.max(shortLeg.spreadWidthPct, longLeg.spreadWidthPct),
        volumeNorm: Math.min(
          this.clamp(shortLeg.volume / cfg.liquidity.volumeMaxRefDefault, 0, 1),
          this.clamp(longLeg.volume / cfg.liquidity.volumeMaxRefDefault, 0, 1)
        ),
        oiNorm: Math.min(
          this.clamp(shortLeg.oi / cfg.liquidity.oiMaxRefDefault, 0, 1),
          this.clamp(longLeg.oi / cfg.liquidity.oiMaxRefDefault, 0, 1)
        ),
      },
      marketContext,
      constructionVersion: CONSTRUCTION_VERSION,
      constructionLatencyMs: elapsedMs,
      createdAt: new Date(),
    };
  }

  private buildSingleLegPlan(
    candidate: OptionCandidate,
    intent: TradeIntent,
    marketContext: MarketContext,
    cfg: ReturnType<typeof getEngineConfig>,
    startMs: number
  ): TradePlan {
    const maxLossPerContract = candidate.mid * 100;
    const maxContracts = Math.floor(intent.maxRiskPerTrade / maxLossPerContract);
    const contracts = Math.max(1, maxContracts);

    const legs: TradePlanLeg[] = [
      this.candidateToLeg(candidate, LegRole.LONG),
    ];

    const elapsedMs = performance.now() - startMs;

    return {
      tradePlanId: randomUUID(),
      accountId: intent.accountId,
      strategyTag: intent.strategyTag,
      structure: intent.structure,
      underlying: intent.underlying,
      contracts,
      legs,
      entryModel: {
        expectedPrice: candidate.mid,
        limitPrice: candidate.mid * 1.02,
        maxRepricingAttempts: cfg.slippage.repriceAttempts,
        repriceIntervalSeconds: cfg.slippage.repriceIntervalSeconds,
      },
      exitModel: {
        profitTargetPct: cfg.exits.creditSpread.profitTargetPct,
        stopLossPct: cfg.exits.creditSpread.stopLossPct,
        maxHoldDays: candidate.dte - 1,
      },
      riskModel: {
        maxLossPerContract,
        maxLossTotal: maxLossPerContract * contracts,
        creditPerSpread: 0,
        spreadWidthDollars: 0,
      },
      liquidityModel: {
        liquidityScore: candidate.liquidityScore,
        spreadWidthPct: candidate.spreadWidthPct,
        volumeNorm: this.clamp(candidate.volume / cfg.liquidity.volumeMaxRefDefault, 0, 1),
        oiNorm: this.clamp(candidate.oi / cfg.liquidity.oiMaxRefDefault, 0, 1),
      },
      marketContext,
      constructionVersion: CONSTRUCTION_VERSION,
      constructionLatencyMs: elapsedMs,
      createdAt: new Date(),
    };
  }

  // ─── Protection Leg Finding ───

  private getProtectionDelta(intent: TradeIntent): number {
    // Protection leg should be further OTM
    // For credit spreads, short is closer to ATM, long is further OTM
    return Math.max(0.05, intent.targetDelta * 0.5);
  }

  private findProtectionLeg(
    candidates: OptionCandidate[],
    shortLeg: OptionCandidate,
    protectionDelta: number,
    _intent: TradeIntent
  ): OptionCandidate | null {
    // Must match: same expiration, same right, further OTM
    const eligible = candidates.filter(c => {
      if (c.optionTicker === shortLeg.optionTicker) return false;
      if (c.expiration !== shortLeg.expiration) return false;
      if (c.right !== shortLeg.right) return false;
      if (c.delta === null) return false;

      const absDelta = Math.abs(c.delta);
      // Long leg must be further OTM (lower abs delta) than short leg
      if (absDelta >= Math.abs(shortLeg.delta!)) return false;

      return true;
    });

    if (eligible.length === 0) return null;

    // Pick the one closest to protection delta
    eligible.sort((a, b) => {
      const diffA = Math.abs(Math.abs(a.delta!) - protectionDelta);
      const diffB = Math.abs(Math.abs(b.delta!) - protectionDelta);
      return diffA - diffB;
    });

    return eligible[0];
  }

  // ─── Helpers ───

  private candidateToLeg(c: OptionCandidate, role: LegRole): TradePlanLeg {
    return {
      legRole: role,
      optionTicker: c.optionTicker,
      expiration: c.expiration,
      strike: c.strike,
      right: c.right,
      dte: c.dte,
      delta: c.delta ?? 0,
      gamma: c.gamma ?? 0,
      vega: c.vega ?? 0,
      iv: c.iv ?? 0,
      greekSource: c.greekSource,
      bid: c.bid,
      ask: c.ask,
      mid: c.mid,
      volume: c.volume,
      oi: c.oi,
      spreadWidth: c.spreadWidth,
      spreadWidthPct: c.spreadWidthPct,
      liquidityScore: c.liquidityScore,
      sanityCheckPassed: c.sanityCheckPassed,
      quoteTimestamp: c.quoteTimestamp,
    };
  }

  private getTargetRight(structure: TradeStructure, _direction: TradeDirection): OptionRight | null {
    switch (structure) {
      case TradeStructure.LONG_CALL:
      case TradeStructure.CREDIT_CALL_SPREAD:
        return OptionRight.C;
      case TradeStructure.LONG_PUT:
      case TradeStructure.CREDIT_PUT_SPREAD:
        return OptionRight.P;
      default:
        return null;
    }
  }

  private buildRejection(
    codes: RejectionCode[],
    counts: CandidateCounts,
    underlyingPrice: number,
    startMs: number
  ): ConstructionResult {
    return {
      success: false,
      tradePlan: null,
      rejection: {
        rejectionCodes: codes,
        candidateCounts: counts,
        constructionLatencyMs: performance.now() - startMs,
        underlyingPrice,
        timestamp: new Date(),
      },
    };
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private safeNumber(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value;
  }
}

export const optionsConstructionEngine = new OptionsConstructionEngine();
