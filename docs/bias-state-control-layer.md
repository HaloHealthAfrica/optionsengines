# Bias State Control Layer

This document describes the Bias State Aggregator control layer: UnifiedBiasState schema, risk adjustment philosophy, portfolio guard rules, setup validator rules, and acceleration metrics.

---

## UnifiedBiasState Schema

The canonical state consumed by Engines A/B and downstream modules:

```json
{
  "symbol": "SPY",
  "updatedAtMs": 1707890400000,
  "source": "MTF_BIAS_ENGINE_V3",
  "chartTf": "15m",
  "session": "RTH",
  "bias": "BULLISH",
  "biasScore": 72,
  "confidence": 0.78,
  "alignmentScore": 85,
  "conflictScore": 12,
  "regimeType": "TREND",
  "chopScore": 45,
  "adx15m": 28,
  "atrState15m": "EXPANDING",
  "macroClass": "MACRO_TREND_UP",
  "macroConfidence": 0.82,
  "intentType": "BREAKOUT",
  "intentConfidence": 0.75,
  "regimeTransition": false,
  "trendPhase": "MID",
  "levels": { "vwap": {...}, "orb": {...}, "swings": {...} },
  "trigger": { "barType": "2_UP", "pattern": "2-1-2_UP", "triggered": true },
  "liquidity": { "sweepHigh": false, "sweepLow": false, "reclaim": true },
  "space": { "roomToResistance": "HIGH", "roomToSupport": "MEDIUM" },
  "riskContext": { "invalidation": {...}, "entryModeHint": "BREAKOUT" },
  "gamma": { "gammaEnvironment": "POSITIVE", "gammaMagnitude": "MEDIUM", ... },
  "transitions": { "biasFlip": false, "macroFlip": false, ... },
  "effective": {
    "tradeSuppressed": false,
    "effectiveBiasScore": 72,
    "effectiveConfidence": 0.78,
    "riskMultiplier": 1.0,
    "notes": []
  },
  "acceleration": {
    "stateStrengthDelta": 8,
    "intentMomentumDelta": 2,
    "macroDriftScore": 0.05
  }
}
```

---

## Risk Adjustment Philosophy

Position sizing uses layered modifiers applied in order:

1. **Base Risk** — `baseRiskPercent` (e.g. 1%)
2. **Aggregator Risk Multiplier** — from `effective.riskMultiplier` (gating output)
3. **Macro Layer** — suppress or boost based on `macroClass` vs direction
4. **Regime Layer** — penalize breakout in range, boost trend alignment
5. **Acceleration Layer** — scale by `stateStrengthDelta`, `macroDriftScore`
6. **Late Phase Guard** — reduce risk when `trendPhase == LATE` and delta negative

Hard limits: minimum 0.25x base, maximum 1.5x base.

---

## Risk Model Modifiers

| Condition | Modifier |
|-----------|----------|
| `macroClass == MACRO_BREAKDOWN_CONFIRMED` + long | ×0.5 |
| `macroClass == MACRO_TREND_UP` + long | ×1.15 |
| `macroClass == MACRO_TREND_DOWN` + short | ×0.5 |
| `regimeType == RANGE` + strategy BREAKOUT | ×0.7 |
| `regimeType == TREND` + alignmentScore > 75 | ×1.1 |
| `stateStrengthDelta > 15` | ×1.1 |
| `stateStrengthDelta < -20` | ×0.8 |
| `macroDriftScore > 0.15` | ×0.85 |
| `trendPhase == LATE` + delta < 0 | ×0.75 |

---

## Portfolio Guard Rules

### Macro Drift Guard

- If `macroDriftScore > 0.15` OR `macroFlip == true`:
  - Reduce allowed new exposure by 50%
  - Force defined-risk trades only

### Range Regime Guard

- If `regimeType == RANGE` AND `chopScore > 70`:
  - Cap concurrent directional trades to 2
  - Block breakout-only strategies

### Volatility Expansion Guard

- If `atrState15m == EXPANDING` AND macro unstable:
  - Reduce total exposure 20%
  - Enforce wider stops (via risk model)

### Macro Bias Cluster

- Block when clustering risk exceeds threshold (e.g. 3+ longs in bearish macro)

---

## Setup Validator Rules

### Blocking Rules

| Rule | Condition | Action |
|------|-----------|--------|
| Breakout Without Space | `intentType == BREAKOUT` AND `space.roomToResistance == LOW` | Reject |
| No Trigger Confirmation | `trigger.triggered == false` (unless anticipatory allowed) | Reject |
| Liquidity Trap | `sweepHigh == true`, `reclaim == false`, direction LONG | Reject continuation |
| Range Suppression | `regimeType == RANGE` AND `strategyType != MEAN_REVERT` | Reject |

Rejection reasons are returned for monitoring.

---

## Acceleration Explanation

Acceleration metrics capture state change momentum:

- **stateStrengthDelta** — Change in bias strength vs previous state (>15 = strengthening, <-20 = weakening)
- **intentMomentumDelta** — Change in intent confidence
- **macroDriftScore** — Macro instability (0–1; >0.15 = elevated drift)

Used for risk scaling and portfolio guard triggers.

---

## Example State JSON

```json
{
  "symbol": "QQQ",
  "bias": "BULLISH",
  "biasScore": 65,
  "regimeType": "TREND",
  "macroClass": "MACRO_TREND_UP",
  "trendPhase": "MID",
  "intentType": "PULLBACK",
  "space": { "roomToResistance": "HIGH", "roomToSupport": "MEDIUM" },
  "trigger": { "triggered": true },
  "effective": { "riskMultiplier": 1.0, "tradeSuppressed": false },
  "acceleration": { "stateStrengthDelta": 5, "macroDriftScore": 0.03 }
}
```

---

## Example Rejection Scenario

**Setup:** Breakout intent, LOW room to resistance, RANGE regime.

- **Breakout Without Space** → Reject (reason: `BREAKOUT_WITHOUT_SPACE`)
- **Range Suppression** (if strategy != MEAN_REVERT) → Reject (reason: `RANGE_SUPPRESSION_NON_MEAN_REVERT`)

---

## Example Macro Drift Exposure Block

**Setup:** `macroDriftScore = 0.18`, `macroFlip = true`, attempt new long.

- **Macro Drift Guard** → Reduce allowed exposure 50%, force defined-risk only
- If `macroBiasCluster >= 3` (e.g. 3 longs in bearish macro) → **BLOCK**

---

## Conflict Resolver (Weighted Merge)

When multiple sources exist:

```
finalBiasScore = mtfBiasScore × 0.7 + gammaBiasScore × 0.3
```

Weights configurable via `MergeWeights`. Gamma score derived from `gammaEnvironment`: POSITIVE → 70, NEGATIVE → -70, NEUTRAL → 0.
