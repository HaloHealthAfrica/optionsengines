import { logger } from '../../utils/logger.js';
import { RejectionCode, GreekSource } from '../types/enums.js';
import { getEngineConfig } from '../config/loader.js';

// ─── Sanity Result Types ───

export interface UnderlyingSanityResult {
  passed: boolean;
  price: number;
  priorClose: number | null;
  movePct: number | null;
  rejectionCode: RejectionCode | null;
  reason: string | null;
}

export interface CandidateSanityResult {
  passed: boolean;
  optionTicker: string;
  rejectionCode: RejectionCode | null;
  reason: string | null;
  warnings: string[];
}

export interface SanityValidationSummary {
  underlyingResult: UnderlyingSanityResult;
  candidateResults: CandidateSanityResult[];
  passedCount: number;
  rejectedCount: number;
  totalCount: number;
}

// ─── Input Types ───

export interface UnderlyingInput {
  price: number;
  priorClose: number | null;
}

export interface CandidateInput {
  optionTicker: string;
  bid: number;
  ask: number;
  mid: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  volume: number;
  oi: number;
  spreadWidthPct: number;
  quoteTimestamp: Date;
  underlyingPrice: number;
  greekSource: GreekSource;
  uwDelta?: number | null;
  massiveDelta?: number | null;
}

export class DataSanityValidator {

  // ─── Underlying Price Sanity (before chain discovery) ───

  validateUnderlying(input: UnderlyingInput): UnderlyingSanityResult {
    const config = getEngineConfig().sanity;

    if (input.price <= 0) {
      return {
        passed: false,
        price: input.price,
        priorClose: input.priorClose,
        movePct: null,
        rejectionCode: RejectionCode.UNDERLYING_PRICE_SANITY_FAILURE,
        reason: `Underlying price <= 0: ${input.price}`,
      };
    }

    if (input.priorClose !== null && input.priorClose > 0) {
      const movePct = Math.abs(input.price - input.priorClose) / input.priorClose;
      if (movePct > config.maxUnderlyingMovePct) {
        return {
          passed: false,
          price: input.price,
          priorClose: input.priorClose,
          movePct,
          rejectionCode: RejectionCode.UNDERLYING_PRICE_SANITY_FAILURE,
          reason: `Underlying move ${(movePct * 100).toFixed(2)}% exceeds max ${(config.maxUnderlyingMovePct * 100).toFixed(1)}%`,
        };
      }

      return {
        passed: true,
        price: input.price,
        priorClose: input.priorClose,
        movePct,
        rejectionCode: null,
        reason: null,
      };
    }

    return {
      passed: true,
      price: input.price,
      priorClose: input.priorClose,
      movePct: null,
      rejectionCode: null,
      reason: null,
    };
  }

  // ─── Candidate Sanity (per option candidate) ───

  validateCandidate(input: CandidateInput): CandidateSanityResult {
    const config = getEngineConfig().sanity;
    const warnings: string[] = [];
    const now = Date.now();

    // bid > ask
    if (input.bid > input.ask) {
      return this.reject(input.optionTicker, RejectionCode.DATA_SANITY_FAILURE,
        `bid (${input.bid}) > ask (${input.ask})`, warnings);
    }

    // bid < 0 or ask < 0
    if (input.bid < 0 || input.ask < 0) {
      return this.reject(input.optionTicker, RejectionCode.DATA_SANITY_FAILURE,
        `Negative bid (${input.bid}) or ask (${input.ask})`, warnings);
    }

    // mid <= 0
    if (input.mid <= 0) {
      return this.reject(input.optionTicker, RejectionCode.DATA_SANITY_FAILURE,
        `mid <= 0: ${input.mid}`, warnings);
    }

    // spreadWidthPct > maxSpreadWidthSanity
    if (input.spreadWidthPct > config.maxSpreadWidthSanity) {
      return this.reject(input.optionTicker, RejectionCode.DATA_SANITY_FAILURE,
        `spreadWidthPct ${input.spreadWidthPct.toFixed(4)} > max ${config.maxSpreadWidthSanity}`, warnings);
    }

    // delta out of range
    if (input.delta !== null && Math.abs(input.delta) > config.maxDelta) {
      return this.reject(input.optionTicker, RejectionCode.DATA_SANITY_FAILURE,
        `|delta| ${Math.abs(input.delta).toFixed(4)} > max ${config.maxDelta}`, warnings);
    }

    // IV out of range
    if (input.iv !== null) {
      if (input.iv < 0 || input.iv > config.maxIV) {
        return this.reject(input.optionTicker, RejectionCode.DATA_SANITY_FAILURE,
          `IV ${input.iv} out of range [0, ${config.maxIV}]`, warnings);
      }
    }

    // mid < minOptionPremium
    if (input.mid < config.minOptionPremium) {
      return this.reject(input.optionTicker, RejectionCode.DATA_SANITY_FAILURE,
        `mid ${input.mid} < minOptionPremium ${config.minOptionPremium}`, warnings);
    }

    // Quote too old (> 30s) — using snapshotMaxAgeAtUseSeconds from cache config
    const quoteAgeMs = now - input.quoteTimestamp.getTime();
    const maxAgeMs = getEngineConfig().cache.snapshotMaxAgeAtUseSeconds * 1000;
    if (quoteAgeMs > maxAgeMs) {
      return this.reject(input.optionTicker, RejectionCode.STALE_SNAPSHOT,
        `Quote age ${(quoteAgeMs / 1000).toFixed(1)}s exceeds max ${maxAgeMs / 1000}s`, warnings);
    }

    // Gamma sign sanity: reject if gamma < -epsilon
    if (input.gamma !== null && input.gamma < -config.gammaNegativeEpsilon) {
      return this.reject(input.optionTicker, RejectionCode.GAMMA_SIGN_SANITY_FAILURE,
        `gamma ${input.gamma} < -${config.gammaNegativeEpsilon}`, warnings);
    }

    // Deep ITM handling: mid > underlyingPrice
    if (input.mid > input.underlyingPrice) {
      const deepITMAllowed = this.checkDeepITM(input, config);
      if (!deepITMAllowed.allowed) {
        return this.reject(input.optionTicker, RejectionCode.DATA_SANITY_FAILURE,
          deepITMAllowed.reason, warnings);
      }
      warnings.push('ITM_PLAUSIBLE_WARNING');
    }

    // Greek consistency: if both UW and Massive provide delta, check mismatch
    if (input.uwDelta !== null && input.uwDelta !== undefined &&
        input.massiveDelta !== null && input.massiveDelta !== undefined) {
      const mismatch = Math.abs(input.uwDelta - input.massiveDelta);
      if (mismatch > config.maxGreekMismatch) {
        return this.reject(input.optionTicker, RejectionCode.GREEK_SOURCE_UNAVAILABLE,
          `Greek delta mismatch: UW=${input.uwDelta.toFixed(4)}, Massive=${input.massiveDelta.toFixed(4)}, diff=${mismatch.toFixed(4)} > max ${config.maxGreekMismatch}`,
          warnings);
      }
    }

    return {
      passed: true,
      optionTicker: input.optionTicker,
      rejectionCode: null,
      reason: null,
      warnings,
    };
  }

  // ─── Batch Validation ───

  validateCandidates(
    underlying: UnderlyingInput,
    candidates: CandidateInput[]
  ): SanityValidationSummary {
    const underlyingResult = this.validateUnderlying(underlying);

    if (!underlyingResult.passed) {
      logger.warn('Underlying sanity check failed', {
        price: underlying.price,
        reason: underlyingResult.reason,
      });
      return {
        underlyingResult,
        candidateResults: [],
        passedCount: 0,
        rejectedCount: candidates.length,
        totalCount: candidates.length,
      };
    }

    const candidateResults = candidates.map(c => this.validateCandidate(c));
    const passedCount = candidateResults.filter(r => r.passed).length;
    const rejectedCount = candidateResults.filter(r => !r.passed).length;

    if (rejectedCount > 0) {
      const rejectionCounts = this.countRejections(candidateResults);
      logger.info('Data sanity validation completed', {
        total: candidates.length,
        passed: passedCount,
        rejected: rejectedCount,
        rejectionCounts,
      });
    }

    return {
      underlyingResult,
      candidateResults,
      passedCount,
      rejectedCount,
      totalCount: candidates.length,
    };
  }

  // ─── Deep ITM Check ───

  private checkDeepITM(
    input: CandidateInput,
    _config: { minOptionPremium: number }
  ): { allowed: boolean; reason: string } {
    const liquidityConfig = getEngineConfig().liquidity;

    if (input.delta !== null && Math.abs(input.delta) >= 0.95 &&
        input.volume >= liquidityConfig.minVolume &&
        input.oi >= liquidityConfig.minOI) {
      return { allowed: true, reason: '' };
    }

    return {
      allowed: false,
      reason: `Deep ITM (mid ${input.mid} > underlying ${input.underlyingPrice}) but |delta|=${input.delta !== null ? Math.abs(input.delta).toFixed(3) : 'null'}, volume=${input.volume}, oi=${input.oi} — insufficient to confirm plausibility`,
    };
  }

  // ─── Helpers ───

  private reject(
    optionTicker: string,
    code: RejectionCode,
    reason: string,
    warnings: string[]
  ): CandidateSanityResult {
    return {
      passed: false,
      optionTicker,
      rejectionCode: code,
      reason,
      warnings,
    };
  }

  private countRejections(results: CandidateSanityResult[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const r of results) {
      if (r.rejectionCode) {
        counts[r.rejectionCode] = (counts[r.rejectionCode] ?? 0) + 1;
      }
    }
    return counts;
  }
}

export const dataSanityValidator = new DataSanityValidator();
