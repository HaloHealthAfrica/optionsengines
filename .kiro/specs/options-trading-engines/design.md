# Design Document: Options Trading Engines

## Overview

This design specifies three interconnected decision engines for options trading: Entry Decision Engine, Strike Selection Engine, and Exit Decision Engine. These engines operate as stateless, deterministic TypeScript services within a Next.js trading platform, providing execution-layer decision-making without signal generation or order placement.

**Core Design Principles:**
- **Determinism**: Identical inputs always produce identical outputs
- **Auditability**: Every decision is fully logged with rationale
- **Statelessness**: No state maintained between requests
- **Type Safety**: Full TypeScript typing throughout
- **Rule-Based**: Explicit, hierarchical rule evaluation
- **Conservative Bias**: When multiple rules trigger, prefer the most conservative action

**Integration Context:**
The engines integrate with existing platform services:
- Signal ingestion (upstream)
- Multi-agent decisioning (peer)
- Regime detection (data source)
- Risk orchestration (data source)
- Order placement (downstream, out of scope)

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────┐
│                    Trading Platform                          │
│                                                              │
│  ┌──────────────┐      ┌──────────────────────────────┐   │
│  │   Signal     │─────▶│   Entry Decision Engine      │   │
│  │  Ingestion   │      │   /lib/entryEngine/          │   │
│  └──────────────┘      └──────────┬───────────────────┘   │
│                                    │                         │
│  ┌──────────────┐                 │ ENTER decision         │
│  │   Regime     │─────────────────┤                         │
│  │  Detection   │                 │                         │
│  └──────────────┘                 ▼                         │
│                        ┌──────────────────────────────┐    │
│  ┌──────────────┐     │  Strike Selection Engine     │    │
│  │     Risk     │────▶│  /lib/strikeSelection/       │    │
│  │ Orchestration│     └──────────┬───────────────────┘    │
│  └──────────────┘                │                         │
│                                   │ Trade contract         │
│  ┌──────────────┐                │                         │
│  │   Position   │                │                         │
│  │   Tracking   │────────────────┤                         │
│  └──────────────┘                ▼                         │
│                        ┌──────────────────────────────┐    │
│                        │   Exit Decision Engine       │    │
│                        │   /lib/exitEngine/           │    │
│                        └──────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Module Structure


```
/lib/
  entryEngine/
    index.ts              # Entry decision API
    types.ts              # Input/output contracts
    rules/
      tier1HardBlocks.ts  # Hard blocking rules
      tier2Delays.ts      # Delay/wait rules
      tier3Entry.ts       # Entry approval rules
    evaluator.ts          # Main decision logic
    logger.ts             # Audit logging
    
  strikeSelection/
    index.ts              # Strike selection API
    types.ts              # Input/output contracts
    filters/
      dteFilter.ts        # DTE policy enforcement
      liquidityFilter.ts  # Liquidity gates
      greeksFilter.ts     # Greeks constraints
    scoring/
      scorer.ts           # Contract scoring engine
      weights.ts          # Mode-specific weightings
    selector.ts           # Main selection logic
    logger.ts             # Audit logging
    
  exitEngine/
    index.ts              # Exit decision API
    types.ts              # Input/output contracts
    rules/
      tier1HardFail.ts    # Must-exit rules
      tier2Protection.ts  # Capital protection rules
      tier3Profit.ts      # Profit-taking rules
      tier4Degradation.ts # Degradation management
    greeksAnalyzer.ts     # Greeks change analysis
    evaluator.ts          # Main decision logic
    logger.ts             # Audit logging
    
  shared/
    types.ts              # Common types across engines
    constants.ts          # Shared constants
    validators.ts         # Input validation utilities
```

## Components and Interfaces

### Entry Decision Engine

**Input Contract (EntryDecisionInput):**
```typescript
interface EntryDecisionInput {
  // Trade identification
  symbol: string;
  timestamp: number;
  direction: 'CALL' | 'PUT';
  setupType: SetupType;
  
  // Signal data
  signal: {
    confidence: number;      // 0-100
    pattern: string;
    timeframe: string;
  };
  
  // Market context
  marketContext: {
    price: number;
    regime: RegimeType;
    gexState: GEXState;
    volatility: number;
    ivPercentile: number;
  };
  
  // Timing context
  timingContext: {
    session: SessionType;
    minutesFromOpen: number;
    liquidityState: LiquidityState;
  };
  
  // Risk context
  riskContext: {
    dailyPnL: number;
    openTradesCount: number;
    portfolioDelta: number;
    portfolioTheta: number;
  };
}
```

**Output Contract (EntryDecisionOutput):**
```typescript
interface EntryDecisionOutput {
  action: 'ENTER' | 'WAIT' | 'BLOCK';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  entryInstructions?: {
    entryType: 'MARKET' | 'LIMIT' | 'STOP_LIMIT';
    confirmationRequired: boolean;
    maxWaitMinutes: number;
  };
  triggeredRules: RuleResult[];
  rationale: string[];
  timestamp: number;
}
```

**Rule Evaluation Logic:**

The Entry Decision Engine evaluates rules in strict hierarchical order:

1. **Tier 1 - Hard Blocks**: If any Tier 1 rule triggers, return BLOCK immediately
   - Signal confidence < minimum threshold (varies by setup type)
   - Regime conflict (e.g., bearish regime + CALL)
   - Volatility mismatch (e.g., low volatility + SCALP_GUARDED)
   - Portfolio guardrails breached (max trades, delta limits, daily loss limits)
   - Liquidity unsafe (spread too wide, volume too low)

2. **Tier 2 - Delays**: If no Tier 1 violations but Tier 2 triggers, return WAIT
   - Confirmation pending (multi-timeframe alignment not yet confirmed)
   - Bad timing window (first/last 15 minutes, lunch hour for scalps)
   - GEX proximity (near major gamma walls)

3. **Tier 3 - Entry Approval**: If no Tier 1 or Tier 2 violations, return ENTER
   - Set urgency based on signal strength and timing
   - Generate mode-specific entry instructions
   - Compile rationale from all evaluated rules

**Mode-Specific Entry Instructions:**


```typescript
// SCALP_GUARDED
{
  entryType: 'LIMIT' | 'STOP_LIMIT',  // Never MARKET
  confirmationRequired: true,
  maxWaitMinutes: 5-10
}

// SWING
{
  entryType: confidence >= 80 ? 'MARKET' : 'LIMIT',
  confirmationRequired: confidence < 70,
  maxWaitMinutes: 30-60
}

// POSITION
{
  entryType: 'LIMIT',
  confirmationRequired: true,
  maxWaitMinutes: 120-240  // Can stage entries
}

// LEAPS
{
  entryType: 'LIMIT',
  confirmationRequired: false,  // Timing less critical
  maxWaitMinutes: 480-1440  // Can wait days
}
```

### Strike Selection Engine

**Input Contract (StrikeSelectionInput):**
```typescript
interface StrikeSelectionInput {
  // Trade parameters
  symbol: string;
  spotPrice: number;
  direction: 'CALL' | 'PUT';
  setupType: SetupType;
  
  // Signal characteristics
  signalConfidence: number;
  expectedHoldTime: number;  // minutes
  expectedMovePercent: number;
  
  // Market environment
  regime: RegimeType;
  gexState: GEXState;
  ivPercentile: number;
  eventRisk: EventRisk[];
  
  // Risk budget
  riskBudget: {
    maxPremiumLoss: number;
    maxCapitalAllocation: number;
  };
  
  // Option chain
  optionChain: OptionContract[];
}

interface OptionContract {
  expiry: string;
  dte: number;
  strike: number;
  bid: number;
  ask: number;
  mid: number;
  openInterest: number;
  volume: number;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
  iv: number;
}
```

**Output Contract (StrikeSelectionOutput):**
```typescript
interface StrikeSelectionOutput {
  success: boolean;
  
  // If success = true
  tradeContract?: {
    symbol: string;
    direction: 'CALL' | 'PUT';
    setupType: SetupType;
    expiry: string;
    dte: number;
    strike: number;
    midPrice: number;
    greeksSnapshot: Greeks;
  };
  
  scores?: {
    overall: number;  // 0-100
    breakdown: {
      liquidityFitness: number;
      greeksStability: number;
      thetaSurvivability: number;
      vegaIVAlignment: number;
      costEfficiency: number;
      gexSuitability: number;
    };
  };
  
  guardrails?: {
    maxHoldTime: number;      // minutes
    timeStops: number[];      // timestamps
    progressChecks: ProgressCheck[];
    thetaBurnLimit: number;   // percentage
    invalidationLevels: {
      stopLoss: number;
      thesisInvalidation: number;
    };
  };
  
  rationale?: string[];
  
  // If success = false
  failureReason?: 'NO_VALID_STRIKE';
  failedChecks?: string[];
}
```

**DTE Policy Enforcement:**

Hard rules enforced before any scoring:
```typescript
const DTE_POLICY: Record<SetupType, { min: number; max: number; preferred?: [number, number] }> = {
  SCALP_GUARDED: { min: 3, max: 14 },  // NO 0DTE
  SWING: { min: 21, max: 90, preferred: [30, 60] },
  POSITION: { min: 90, max: 180 },
  LEAPS: { min: 180, max: 720, preferred: [270, 540] }  // 9-18 months
};
```

**Liquidity Gates:**

Hard gates enforced before scoring:
```typescript
const LIQUIDITY_GATES: Record<SetupType, LiquidityRequirements> = {
  SCALP_GUARDED: {
    maxSpreadPercent: 8,
    minOpenInterest: 1000,
    minVolume: 500
  },
  SWING: {
    maxSpreadPercent: 12,
    minOpenInterest: 300,
    minVolume: 100
  },
  POSITION: {
    maxSpreadPercent: 15,
    minOpenInterest: 300,
    minVolume: 100
  },
  LEAPS: {
    maxSpreadPercent: 10,  // Stricter for LEAPS
    minOpenInterest: 200,
    minVolume: 50
  }
};
```

**Greeks Constraints:**


```typescript
const DELTA_RANGES: Record<SetupType, { min: number; max: number }> = {
  SCALP_GUARDED: { min: 0.45, max: 0.65 },
  SWING: { min: 0.25, max: 0.40 },
  POSITION: { min: 0.20, max: 0.35 },
  LEAPS: { min: 0.15, max: 0.30 }
};

// Theta constraint: daily theta decay should not exceed X% of premium per day
function thetaSurvivable(theta: number, premium: number, holdDays: number): boolean {
  const dailyDecay = Math.abs(theta);
  const totalDecay = dailyDecay * holdDays;
  const decayPercent = (totalDecay / premium) * 100;
  
  // Mode-specific tolerance
  const tolerance = {
    SCALP_GUARDED: 20,  // Can tolerate 20% decay over 1-2 days
    SWING: 30,          // Can tolerate 30% decay over 7-14 days
    POSITION: 40,       // Can tolerate 40% decay over 30-60 days
    LEAPS: 50           // Can tolerate 50% decay over 180+ days
  };
  
  return decayPercent <= tolerance[setupType];
}

// Gamma constraint: penalize high gamma for non-scalp setups
function gammaAcceptable(gamma: number, setupType: SetupType): boolean {
  if (setupType === 'SCALP_GUARDED') {
    return gamma <= 0.05;  // Cap gamma even for scalps
  }
  return gamma <= 0.02;  // Lower gamma for swing+
}

// Vega constraint: penalize high vega when IV is elevated
function vegaAcceptable(vega: number, ivPercentile: number): boolean {
  if (ivPercentile > 70) {
    return vega <= 0.15;  // Avoid high vega in high IV
  }
  return true;  // Vega okay in normal/low IV
}
```

**Strike Scoring Model:**

Each contract that passes filters receives a score 0-100:

```typescript
interface ScoringWeights {
  liquidityFitness: number;
  greeksStability: number;
  thetaSurvivability: number;
  vegaIVAlignment: number;
  costEfficiency: number;
  gexSuitability: number;
}

const SCORING_WEIGHTS: Record<SetupType, ScoringWeights> = {
  SCALP_GUARDED: {
    liquidityFitness: 0.30,    // Critical for fast execution
    greeksStability: 0.20,
    thetaSurvivability: 0.15,
    vegaIVAlignment: 0.10,
    costEfficiency: 0.15,
    gexSuitability: 0.10
  },
  SWING: {
    liquidityFitness: 0.20,
    greeksStability: 0.25,     // Important for multi-day holds
    thetaSurvivability: 0.25,  // Critical for swing
    vegaIVAlignment: 0.15,
    costEfficiency: 0.10,
    gexSuitability: 0.05
  },
  POSITION: {
    liquidityFitness: 0.15,
    greeksStability: 0.30,
    thetaSurvivability: 0.30,
    vegaIVAlignment: 0.15,
    costEfficiency: 0.05,
    gexSuitability: 0.05
  },
  LEAPS: {
    liquidityFitness: 0.10,
    greeksStability: 0.25,
    thetaSurvivability: 0.35,  // Most critical for LEAPS
    vegaIVAlignment: 0.20,     // IV environment matters
    costEfficiency: 0.05,
    gexSuitability: 0.05
  }
};

function scoreContract(contract: OptionContract, input: StrikeSelectionInput): number {
  const weights = SCORING_WEIGHTS[input.setupType];
  
  const scores = {
    liquidityFitness: scoreLiquidity(contract),
    greeksStability: scoreGreeksStability(contract, input.setupType),
    thetaSurvivability: scoreThetaSurvivability(contract, input.expectedHoldTime),
    vegaIVAlignment: scoreVegaIVAlignment(contract, input.ivPercentile),
    costEfficiency: scoreCostEfficiency(contract, input.riskBudget),
    gexSuitability: scoreGEXSuitability(contract, input.gexState)
  };
  
  const weightedScore = Object.entries(scores).reduce((total, [key, score]) => {
    return total + (score * weights[key as keyof ScoringWeights]);
  }, 0);
  
  return Math.round(weightedScore);
}
```

**Guardrails Generation:**

When a contract is selected, generate mode-specific guardrails:

```typescript
function generateGuardrails(
  contract: OptionContract,
  setupType: SetupType,
  expectedHoldTime: number
): Guardrails {
  const guardrails: Guardrails = {
    maxHoldTime: 0,
    timeStops: [],
    progressChecks: [],
    thetaBurnLimit: 0,
    invalidationLevels: { stopLoss: 0, thesisInvalidation: 0 }
  };
  
  switch (setupType) {
    case 'SCALP_GUARDED':
      guardrails.maxHoldTime = 90;  // 90 minutes max
      guardrails.progressChecks = [
        { atMinute: 15, minProfitPercent: 5 },
        { atMinute: 30, minProfitPercent: 10 }
      ];
      guardrails.thetaBurnLimit = 20;
      guardrails.invalidationLevels = {
        stopLoss: -15,  // -15% stop
        thesisInvalidation: -10
      };
      break;
      
    case 'SWING':
      guardrails.maxHoldTime = 14 * 24 * 60;  // 14 days
      guardrails.timeStops = [7 * 24 * 60, 10 * 24 * 60];  // Check at 7, 10 days
      guardrails.progressChecks = [
        { atMinute: 3 * 24 * 60, minProfitPercent: 10 },
        { atMinute: 7 * 24 * 60, minProfitPercent: 15 }
      ];
      guardrails.thetaBurnLimit = 30;
      guardrails.invalidationLevels = {
        stopLoss: -25,
        thesisInvalidation: -20
      };
      break;
      
    case 'POSITION':
      guardrails.maxHoldTime = 60 * 24 * 60;  // 60 days
      guardrails.timeStops = [30 * 24 * 60, 45 * 24 * 60];
      guardrails.progressChecks = [
        { atMinute: 14 * 24 * 60, minProfitPercent: 15 },
        { atMinute: 30 * 24 * 60, minProfitPercent: 20 }
      ];
      guardrails.thetaBurnLimit = 40;
      guardrails.invalidationLevels = {
        stopLoss: -30,
        thesisInvalidation: -25
      };
      break;
      
    case 'LEAPS':
      guardrails.maxHoldTime = 365 * 24 * 60;  // 1 year
      guardrails.timeStops = [90 * 24 * 60, 180 * 24 * 60];
      guardrails.progressChecks = [
        { atMinute: 60 * 24 * 60, minProfitPercent: 20 },
        { atMinute: 120 * 24 * 60, minProfitPercent: 30 }
      ];
      guardrails.thetaBurnLimit = 50;
      guardrails.invalidationLevels = {
        stopLoss: -40,
        thesisInvalidation: -35
      };
      break;
  }
  
  return guardrails;
}
```

### Exit Decision Engine

**Input Contract (ExitDecisionInput):**

```typescript
interface ExitDecisionInput {
  // Trade position
  tradePosition: {
    id: string;
    symbol: string;
    direction: 'CALL' | 'PUT';
    setupType: SetupType;
  };
  
  // Entry data
  entryData: {
    timestamp: number;
    underlyingEntryPrice: number;
    optionEntryPrice: number;
    contracts: number;
  };
  
  // Contract details
  contractDetails: {
    expiry: string;
    dteAtEntry: number;
    strike: number;
    greeksAtEntry: Greeks;
  };
  
  // Guardrails from strike selection
  guardrails: Guardrails;
  
  // Targets
  targets: {
    partialTakeProfitPercent: number[];
    fullTakeProfitPercent: number;
    stopLossPercent: number;
  };
  
  // Live market snapshot
  liveMarket: {
    timestamp: number;
    underlyingPrice: number;
    optionBid: number;
    optionAsk: number;
    optionMid: number;
    currentGreeks: Greeks;
    currentIV: number;
    currentDTE: number;
    spreadPercent: number;
    regime: RegimeType;
    gexState: GEXState;
  };
  
  // Optional thesis status
  thesisStatus?: {
    confidenceNow: number;
    thesisValid: boolean;
    htfInvalidation: boolean;
  };
}
```

**Output Contract (ExitDecisionOutput):**
```typescript
interface ExitDecisionOutput {
  action: 'HOLD' | 'PARTIAL_EXIT' | 'FULL_EXIT' | 'TIGHTEN_STOP';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  sizePercent?: number;  // For PARTIAL_EXIT
  newStopLevel?: number;  // For TIGHTEN_STOP
  triggeredRules: RuleResult[];
  rationale: string[];
  metrics: {
    timeInTradeMinutes: number;
    optionPnLPercent: number;
    underlyingMovePercent: number;
    thetaBurnEstimate: number;
    deltaChange: number;
    ivChange: number;
    spreadPercent: number;
  };
  timestamp: number;
}
```

**Rule Evaluation Logic:**

The Exit Decision Engine evaluates rules in strict hierarchical order:

1. **Tier 1 - Hard Fail / Must Exit**: Return FULL_EXIT with HIGH urgency
   - Thesis invalidation (HTF structure broken)
   - SCALP max hold time exceeded (30-90 minutes)
   - Theta burn kill-switch triggered (exceeds mode-specific limit)
   - Risk stop triggered (stop loss hit)

2. **Tier 2 - Protect Capital**: Return PARTIAL_EXIT or FULL_EXIT with MEDIUM/HIGH urgency
   - Progress check failure (not hitting profit milestones)
   - Liquidity deterioration (spread widening significantly)
   - Regime flip against trade direction

3. **Tier 3 - Take Profit**: Return PARTIAL_EXIT with LOW/MEDIUM urgency
   - Partial profit milestones reached (+25%, +50%, +80% for SWING)
   - Full target reached
   - Runner management (scale out as profit increases)

4. **Tier 4 - Degradation Management**: Return TIGHTEN_STOP or PARTIAL_EXIT with LOW urgency
   - Time stops reached without sufficient profit
   - Delta collapse (delta decayed significantly)
   - IV crush / vega risk (IV dropped sharply)

5. **No Rules Triggered**: Return HOLD with current metrics

**Mode-Specific Exit Policies:**

```typescript
const EXIT_POLICIES: Record<SetupType, ExitPolicy> = {
  SCALP_GUARDED: {
    maxHoldMinutes: 90,
    progressChecks: [
      { atMinute: 15, minProfitPercent: 5 },
      { atMinute: 30, minProfitPercent: 10 }
    ],
    thetaBurnLimit: 20,
    profitPartials: [
      { atPercent: 15, exitPercent: 50 },
      { atPercent: 30, exitPercent: 75 }
    ],
    timeStops: []  // Hard max hold instead
  },
  
  SWING: {
    maxHoldMinutes: 14 * 24 * 60,
    progressChecks: [
      { atMinute: 3 * 24 * 60, minProfitPercent: 10 },
      { atMinute: 7 * 24 * 60, minProfitPercent: 15 }
    ],
    thetaBurnLimit: 30,
    profitPartials: [
      { atPercent: 25, exitPercent: 33 },
      { atPercent: 50, exitPercent: 50 },
      { atPercent: 80, exitPercent: 75 }
    ],
    timeStops: [
      { atDay: 7, action: 'CHECK_PROGRESS' },
      { atDay: 14, action: 'EXIT_IF_FLAT' }
    ]
  },
  
  POSITION: {
    maxHoldMinutes: 60 * 24 * 60,
    progressChecks: [
      { atMinute: 14 * 24 * 60, minProfitPercent: 15 },
      { atMinute: 30 * 24 * 60, minProfitPercent: 20 }
    ],
    thetaBurnLimit: 40,
    profitPartials: [
      { atPercent: 30, exitPercent: 33 },
      { atPercent: 60, exitPercent: 50 },
      { atPercent: 100, exitPercent: 75 }
    ],
    timeStops: [
      { atDay: 30, action: 'CHECK_PROGRESS' },
      { atDay: 45, action: 'TIGHTEN_STOP' }
    ]
  },
  
  LEAPS: {
    maxHoldMinutes: 365 * 24 * 60,
    progressChecks: [
      { atMinute: 60 * 24 * 60, minProfitPercent: 20 },
      { atMinute: 120 * 24 * 60, minProfitPercent: 30 }
    ],
    thetaBurnLimit: 50,
    profitPartials: [
      { atPercent: 40, exitPercent: 25 },
      { atPercent: 80, exitPercent: 50 },
      { atPercent: 150, exitPercent: 75 }
    ],
    timeStops: [
      { atDay: 90, action: 'REVIEW_THESIS' },
      { atDay: 180, action: 'CHECK_PROGRESS' }
    ]
  }
};
```

**Greeks-Aware Exit Logic:**


```typescript
// Delta decay rule
function checkDeltaDecay(
  deltaAtEntry: number,
  deltaNow: number,
  setupType: SetupType
): RuleResult | null {
  const decayPercent = ((deltaAtEntry - deltaNow) / deltaAtEntry) * 100;
  
  const thresholds = {
    SCALP_GUARDED: 20,  // 20% delta decay triggers exit
    SWING: 30,
    POSITION: 40,
    LEAPS: 50
  };
  
  if (decayPercent >= thresholds[setupType]) {
    return {
      tier: 4,
      rule: 'DELTA_DECAY',
      triggered: true,
      message: `Delta decayed ${decayPercent.toFixed(1)}% (threshold: ${thresholds[setupType]}%)`
    };
  }
  
  return null;
}

// Gamma stall rule (for SCALP and SWING)
function checkGammaStall(
  gammaAtEntry: number,
  gammaNow: number,
  setupType: SetupType
): RuleResult | null {
  if (setupType !== 'SCALP_GUARDED' && setupType !== 'SWING') {
    return null;  // Not applicable
  }
  
  const gammaDropPercent = ((gammaAtEntry - gammaNow) / gammaAtEntry) * 100;
  
  if (gammaDropPercent >= 50) {  // Gamma dropped 50%+
    return {
      tier: 4,
      rule: 'GAMMA_STALL',
      triggered: true,
      message: `Gamma dropped ${gammaDropPercent.toFixed(1)}%, momentum stalled`
    };
  }
  
  return null;
}

// Theta acceleration rule
function checkThetaAcceleration(
  thetaAtEntry: number,
  thetaNow: number,
  dteAtEntry: number,
  dteNow: number
): RuleResult | null {
  // Theta should decay roughly linearly with time
  const expectedTheta = thetaAtEntry * (dteNow / dteAtEntry);
  const actualTheta = Math.abs(thetaNow);
  const expectedThetaAbs = Math.abs(expectedTheta);
  
  // If actual theta is 50%+ higher than expected, decay is accelerating
  if (actualTheta > expectedThetaAbs * 1.5) {
    return {
      tier: 4,
      rule: 'THETA_ACCELERATION',
      triggered: true,
      message: `Theta decay accelerating: ${actualTheta.toFixed(3)} vs expected ${expectedThetaAbs.toFixed(3)}`
    };
  }
  
  return null;
}

// Vega/IV shock rule
function checkVegaIVShock(
  vegaAtEntry: number,
  vegaNow: number,
  ivAtEntry: number,
  ivNow: number
): RuleResult | null {
  const ivDropPercent = ((ivAtEntry - ivNow) / ivAtEntry) * 100;
  
  // If IV dropped 30%+ and vega is high, this is IV crush
  if (ivDropPercent >= 30 && vegaNow >= 0.15) {
    return {
      tier: 4,
      rule: 'VEGA_IV_SHOCK',
      triggered: true,
      message: `IV crush: IV dropped ${ivDropPercent.toFixed(1)}% with high vega exposure`
    };
  }
  
  // If IV spiked 50%+ (rare but possible), may want to take profit
  const ivSpikePercent = ((ivNow - ivAtEntry) / ivAtEntry) * 100;
  if (ivSpikePercent >= 50) {
    return {
      tier: 3,  // Profit-taking opportunity
      rule: 'VEGA_IV_SPIKE',
      triggered: true,
      message: `IV spike: IV increased ${ivSpikePercent.toFixed(1)}%, consider taking profit`
    };
  }
  
  return null;
}
```

**Decision Determinism:**

When multiple rules trigger across different tiers, the engine must deterministically select the most conservative action:

```typescript
function selectMostConservativeAction(triggeredRules: RuleResult[]): ExitAction {
  // Sort by tier (lower tier = higher priority)
  const sortedRules = triggeredRules.sort((a, b) => a.tier - b.tier);
  
  const highestPriorityTier = sortedRules[0].tier;
  const tierRules = sortedRules.filter(r => r.tier === highestPriorityTier);
  
  // Within same tier, prefer more conservative action
  const actionPriority = {
    'FULL_EXIT': 1,
    'PARTIAL_EXIT': 2,
    'TIGHTEN_STOP': 3,
    'HOLD': 4
  };
  
  // Map tier + rules to actions
  let recommendedAction: ExitAction = 'HOLD';
  
  if (highestPriorityTier === 1) {
    recommendedAction = 'FULL_EXIT';
  } else if (highestPriorityTier === 2) {
    // Tier 2 can be PARTIAL or FULL depending on severity
    const severeRules = ['LIQUIDITY_DETERIORATION', 'REGIME_FLIP'];
    const hasSevere = tierRules.some(r => severeRules.includes(r.rule));
    recommendedAction = hasSevere ? 'FULL_EXIT' : 'PARTIAL_EXIT';
  } else if (highestPriorityTier === 3) {
    recommendedAction = 'PARTIAL_EXIT';
  } else if (highestPriorityTier === 4) {
    // Tier 4 can be TIGHTEN_STOP or PARTIAL_EXIT
    const degradationRules = ['DELTA_DECAY', 'THETA_ACCELERATION'];
    const hasDegradation = tierRules.some(r => degradationRules.includes(r.rule));
    recommendedAction = hasDegradation ? 'TIGHTEN_STOP' : 'PARTIAL_EXIT';
  }
  
  return recommendedAction;
}
```

## Data Models

### Common Types

```typescript
type SetupType = 'SCALP_GUARDED' | 'SWING' | 'POSITION' | 'LEAPS';

type RegimeType = 
  | 'STRONG_BULL' 
  | 'BULL' 
  | 'NEUTRAL' 
  | 'BEAR' 
  | 'STRONG_BEAR'
  | 'CHOPPY'
  | 'BREAKOUT'
  | 'BREAKDOWN';

type GEXState = 
  | 'POSITIVE_HIGH'    // Dealers long gamma, resistance to moves
  | 'POSITIVE_LOW'
  | 'NEUTRAL'
  | 'NEGATIVE_LOW'     // Dealers short gamma, amplification
  | 'NEGATIVE_HIGH';

type LiquidityState = 
  | 'HIGH'      // Tight spreads, high volume
  | 'NORMAL'
  | 'LOW'       // Wide spreads, low volume
  | 'ILLIQUID'; // Dangerous execution

type SessionType = 
  | 'PRE_MARKET'
  | 'OPEN'       // First 30 min
  | 'MORNING'
  | 'LUNCH'
  | 'AFTERNOON'
  | 'CLOSE'      // Last 30 min
  | 'AFTER_HOURS';

interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

interface EventRisk {
  type: 'EARNINGS' | 'FOMC' | 'OPEX' | 'DIVIDEND' | 'ECONOMIC_DATA';
  date: string;
  daysUntil: number;
}

interface RuleResult {
  tier: 1 | 2 | 3 | 4;
  rule: string;
  triggered: boolean;
  message: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface ProgressCheck {
  atMinute: number;
  minProfitPercent: number;
}

interface Guardrails {
  maxHoldTime: number;
  timeStops: number[];
  progressChecks: ProgressCheck[];
  thetaBurnLimit: number;
  invalidationLevels: {
    stopLoss: number;
    thesisInvalidation: number;
  };
}
```

### Validation Schemas

All input contracts must be validated at runtime using Zod or similar:

```typescript
import { z } from 'zod';

const EntryDecisionInputSchema = z.object({
  symbol: z.string().min(1).max(10),
  timestamp: z.number().positive(),
  direction: z.enum(['CALL', 'PUT']),
  setupType: z.enum(['SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS']),
  signal: z.object({
    confidence: z.number().min(0).max(100),
    pattern: z.string(),
    timeframe: z.string()
  }),
  marketContext: z.object({
    price: z.number().positive(),
    regime: z.enum(['STRONG_BULL', 'BULL', 'NEUTRAL', 'BEAR', 'STRONG_BEAR', 'CHOPPY', 'BREAKOUT', 'BREAKDOWN']),
    gexState: z.enum(['POSITIVE_HIGH', 'POSITIVE_LOW', 'NEUTRAL', 'NEGATIVE_LOW', 'NEGATIVE_HIGH']),
    volatility: z.number().nonnegative(),
    ivPercentile: z.number().min(0).max(100)
  }),
  timingContext: z.object({
    session: z.enum(['PRE_MARKET', 'OPEN', 'MORNING', 'LUNCH', 'AFTERNOON', 'CLOSE', 'AFTER_HOURS']),
    minutesFromOpen: z.number().nonnegative(),
    liquidityState: z.enum(['HIGH', 'NORMAL', 'LOW', 'ILLIQUID'])
  }),
  riskContext: z.object({
    dailyPnL: z.number(),
    openTradesCount: z.number().nonnegative(),
    portfolioDelta: z.number(),
    portfolioTheta: z.number()
  })
});

// Similar schemas for StrikeSelectionInput and ExitDecisionInput
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all 69 acceptance criteria, several redundancies were identified:

**Redundancies eliminated:**
- Properties 10.4 and 10.5 are subsumed by the core determinism property (8.1) and statelessness properties (10.1-10.3)
- Individual Tier 1 rule properties (2.1-2.5) can be combined into a single comprehensive property about Tier 1 blocking
- Individual Tier 2 rule properties (2.6-2.8) can be combined into a single property about Tier 2 delays
- Mode-specific entry instruction properties (1.6-1.9) can be combined into a single property with mode-specific validation
- Liquidity gate properties (3.3-3.4) can be combined into a single property with mode-specific thresholds
- Exit mode-specific properties (6.1-6.8) can be grouped by tier rather than by mode
- Greeks degradation properties (7.1-7.4) can be combined into a single comprehensive Greeks monitoring property
- Audit logging properties (8.2-8.4) can be combined into a single cross-engine logging property

This reflection reduces 69 testable criteria to approximately 35 unique, non-redundant properties.

### Entry Decision Engine Properties

**Property 1: Input validation completeness**
*For any* entry decision request, if all required fields (symbol, timestamp, direction, setup type, signal, market context, timing context, risk context) are present and valid, then validation should pass; if any required field is missing or invalid, then validation should fail with a descriptive error.
**Validates: Requirements 1.1, 9.6**

**Property 2: Rule hierarchy enforcement**
*For any* entry decision request where multiple tier rules trigger, the engine should return the action corresponding to the highest priority tier (Tier 1 > Tier 2 > Tier 3), ensuring that blocking rules always take precedence over delays, and delays take precedence over entry approval.
**Validates: Requirements 1.2**

**Property 3: Tier 1 hard blocks**
*For any* entry decision request where at least one Tier 1 condition is violated (low signal confidence, regime conflict, volatility mismatch, portfolio guardrails breach, or unsafe liquidity), the engine should return action BLOCK with the triggered rules and rationale.
**Validates: Requirements 1.3, 2.1, 2.2, 2.3, 2.4, 2.5**

**Property 4: Tier 2 delays**
*For any* entry decision request where no Tier 1 violations exist but at least one Tier 2 condition triggers (pending confirmation, unfavorable timing window, or GEX proximity), the engine should return action WAIT with the triggered rules and rationale.
**Validates: Requirements 1.4, 2.6, 2.7, 2.8**

**Property 5: Entry approval with mode-specific instructions**
*For any* entry decision request where no Tier 1 or Tier 2 violations exist, the engine should return action ENTER with mode-specific entry instructions: SCALP_GUARDED requires LIMIT/STOP_LIMIT with confirmation and 5-10 min max wait; SWING allows MARKET if confidence ≥80; POSITION allows staged entries; LEAPS prefers LIMIT with relaxed timing.
**Validates: Requirements 1.5, 1.6, 1.7, 1.8, 1.9**

**Property 6: Output contract completeness**
*For any* entry decision request, the output should always contain action, urgency, triggered rules, rationale, and timestamp; when action is ENTER, entry instructions should also be present.
**Validates: Requirements 1.10**

**Property 7: Entry engine determinism**
*For any* entry decision request, calling the engine multiple times with identical inputs should produce identical outputs (same action, urgency, entry instructions, triggered rules, and rationale).
**Validates: Requirements 8.1**

**Property 8: Entry engine statelessness**
*For any* sequence of entry decision requests, the output for each request should depend only on that request's input parameters, with no state carried over from previous requests.
**Validates: Requirements 10.1**

### Strike Selection Engine Properties

**Property 9: Strike selection input validation**
*For any* strike selection request, if all required fields (symbol, spot price, direction, setup type, signal confidence, expected hold time, expected move, regime, GEX state, IV percentile, event risk, risk budget, option chain) are present and valid, then validation should pass; if any required field is missing or invalid, then validation should fail with a descriptive error.
**Validates: Requirements 3.1, 9.6**

**Property 10: DTE policy enforcement**
*For any* strike selection request, only option contracts within the mode-specific DTE range should be considered: SCALP_GUARDED 3-14 days, SWING 21-90 days, POSITION 90-180 days, LEAPS 180-720 days.
**Validates: Requirements 3.2**

**Property 11: Liquidity gates enforcement**
*For any* strike selection request, only option contracts meeting mode-specific liquidity requirements should be considered: SCALP (spread ≤8%, OI ≥1000, volume ≥500), SWING/POSITION (spread ≤12-15%, OI ≥300, volume ≥100), LEAPS (spread ≤10%, OI ≥200, volume ≥50).
**Validates: Requirements 3.3, 3.4**

**Property 12: Delta range enforcement**
*For any* strike selection request, only option contracts within the mode-specific delta range should be considered: SCALP 0.45-0.65, SWING 0.25-0.40, POSITION 0.20-0.35, LEAPS 0.15-0.30.
**Validates: Requirements 3.5**

**Property 13: Theta survivability constraint**
*For any* strike selection request, option contracts where theta decay over the expected hold time exceeds the mode-specific tolerance should be rejected or heavily penalized in scoring.
**Validates: Requirements 3.6**

**Property 14: Gamma penalization for non-scalp setups**
*For any* strike selection request with setup type SWING, POSITION, or LEAPS, option contracts with high gamma (>0.02) should receive lower scores than contracts with lower gamma, all else being equal.
**Validates: Requirements 3.7**

**Property 15: Vega penalization in high IV environments**
*For any* strike selection request where IV percentile > 70, option contracts with high vega (>0.15) should receive lower scores than contracts with lower vega, all else being equal.
**Validates: Requirements 3.8**

**Property 16: Scoring range and completeness**
*For any* option contract that passes all filters, the computed score should be in the range 0-100, and the scoring breakdown should include all six dimensions: liquidity fitness, Greeks stability, theta survivability, vega/IV alignment, cost efficiency, and GEX suitability.
**Validates: Requirements 3.9**

**Property 17: Success output completeness**
*For any* strike selection request where at least one valid contract exists, the output should have success=true and include trade contract, scores breakdown, guardrails, and rationale.
**Validates: Requirements 3.10**

**Property 18: Failure output completeness**
*For any* strike selection request where no valid contracts exist (all filtered out), the output should have success=false with failure reason NO_VALID_STRIKE and failed checks.
**Validates: Requirements 3.11**

**Property 19: Strike selection determinism**
*For any* strike selection request, calling the engine multiple times with identical inputs (including identical option chain) should produce identical outputs (same selected contract, same scores, same guardrails).
**Validates: Requirements 4.1, 4.2**

**Property 20: Deterministic tie-breaking**
*For any* strike selection request where multiple contracts have identical scores, the engine should always select the same contract using deterministic tie-breaking rules (e.g., prefer closer expiry, then lower strike for calls/higher strike for puts).
**Validates: Requirements 4.3**

**Property 21: Scoring breakdown auditability**
*For any* successful strike selection, the output should include a complete scoring breakdown showing the individual scores and weights for all six scoring dimensions.
**Validates: Requirements 4.4**

**Property 22: Strike selection statelessness**
*For any* sequence of strike selection requests, the output for each request should depend only on that request's input parameters, with no state carried over from previous requests.
**Validates: Requirements 10.2**

### Exit Decision Engine Properties

**Property 23: Exit decision input validation**
*For any* exit decision request, if all required fields (trade position, entry data, contract details, guardrails, targets, live market snapshot) are present and valid, then validation should pass; if any required field is missing or invalid, then validation should fail with a descriptive error.
**Validates: Requirements 5.1, 9.6**

**Property 24: Exit rule hierarchy enforcement**
*For any* exit decision request where multiple tier rules trigger, the engine should return the action corresponding to the highest priority tier (Tier 1 > Tier 2 > Tier 3 > Tier 4), ensuring that hard fail exits take precedence over capital protection, which takes precedence over profit-taking, which takes precedence over degradation management.
**Validates: Requirements 5.2**

**Property 25: Tier 1 hard fail exits**
*For any* exit decision request where at least one Tier 1 condition triggers (thesis invalidation, SCALP max hold exceeded, theta burn kill-switch, or risk stop hit), the engine should return action FULL_EXIT with urgency HIGH.
**Validates: Requirements 5.3, 6.1, 6.2**

**Property 26: Tier 2 capital protection exits**
*For any* exit decision request where no Tier 1 violations exist but at least one Tier 2 condition triggers (progress check failure, liquidity deterioration, or regime flip), the engine should return action PARTIAL_EXIT or FULL_EXIT with urgency MEDIUM or HIGH.
**Validates: Requirements 5.4, 6.5, 6.7, 6.8**

**Property 27: Tier 3 profit-taking exits**
*For any* exit decision request where no Tier 1 or Tier 2 violations exist but profit targets are reached, the engine should return action PARTIAL_EXIT with urgency LOW or MEDIUM, following mode-specific profit ladders (SCALP at +15%/+30%, SWING at +25%/+50%/+80%, etc.).
**Validates: Requirements 5.5, 6.3, 6.6**

**Property 28: Tier 4 degradation management**
*For any* exit decision request where no higher tier violations exist but degradation signals are present (time stops, delta decay, gamma stall, theta acceleration, or IV shock), the engine should return action TIGHTEN_STOP or PARTIAL_EXIT with urgency LOW.
**Validates: Requirements 5.6, 6.4**

**Property 29: Hold when no rules trigger**
*For any* exit decision request where no exit rules trigger, the engine should return action HOLD with current metrics (time in trade, P&L, Greeks changes, etc.).
**Validates: Requirements 5.7**

**Property 30: Exit output completeness**
*For any* exit decision request, the output should always contain action, urgency, triggered rules, rationale, metrics, and timestamp; when action is PARTIAL_EXIT, size percentage should be present; when action is TIGHTEN_STOP, new stop level should be present.
**Validates: Requirements 5.8**

**Property 31: Greeks degradation detection**
*For any* exit decision request, when Greeks have degraded beyond mode-specific thresholds (delta decay, gamma stall for SCALP/SWING, theta acceleration, or vega exposure during IV shock), the engine should trigger appropriate Tier 4 degradation rules.
**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

**Property 32: Conservative action selection**
*For any* exit decision request where multiple rules trigger within the same tier, the engine should deterministically select the most conservative action (FULL_EXIT > PARTIAL_EXIT > TIGHTEN_STOP > HOLD).
**Validates: Requirements 8.5**

**Property 33: Exit engine determinism**
*For any* exit decision request, calling the engine multiple times with identical inputs should produce identical outputs (same action, urgency, size percentage, triggered rules, rationale, and metrics).
**Validates: Requirements 8.1**

**Property 34: Exit engine statelessness**
*For any* sequence of exit decision requests, the output for each request should depend only on that request's input parameters, with no state carried over from previous requests.
**Validates: Requirements 10.3**

### Cross-Engine Properties

**Property 35: Comprehensive audit logging**
*For any* request to any engine (entry, strike selection, or exit), the engine should log a complete audit record containing inputs, computed metrics, triggered rules, final decision, and timestamp.
**Validates: Requirements 8.2, 8.3, 8.4**


## Error Handling

### Input Validation Errors

All engines must validate inputs before processing and return structured error responses:

```typescript
interface ValidationError {
  type: 'VALIDATION_ERROR';
  field: string;
  message: string;
  received?: any;
}

interface ErrorResponse {
  success: false;
  errors: ValidationError[];
  timestamp: number;
}
```

**Validation Error Scenarios:**
- Missing required fields → Return 400 with field-specific errors
- Invalid enum values → Return 400 with allowed values
- Out-of-range numeric values → Return 400 with valid ranges
- Malformed data structures → Return 400 with structure requirements

### Business Logic Errors

When business logic prevents a valid operation:

```typescript
interface BusinessLogicError {
  type: 'BUSINESS_LOGIC_ERROR';
  code: string;
  message: string;
  context?: Record<string, any>;
}
```

**Business Logic Error Scenarios:**
- Entry engine: All Tier 1 rules trigger → Return BLOCK action (not an error, valid response)
- Strike selection: No valid contracts → Return NO_VALID_STRIKE (not an error, valid response)
- Exit engine: Invalid position state → Return error with context

### System Errors

Unexpected system failures should be caught and logged:

```typescript
interface SystemError {
  type: 'SYSTEM_ERROR';
  message: string;
  stack?: string;
  requestId: string;
}
```

**System Error Handling:**
- Catch all unhandled exceptions at API boundary
- Log full error details with request ID
- Return 500 with sanitized error message (no stack traces to client)
- Ensure audit log is written even on error

### Error Recovery

Since engines are stateless, error recovery is straightforward:
- No state to clean up or rollback
- Client can retry with corrected inputs
- Each request is independent

### Logging Strategy

All errors must be logged with:
- Timestamp
- Request ID (for tracing)
- Engine name
- Input parameters (sanitized if needed)
- Error type and message
- Stack trace (for system errors)

## Testing Strategy

### Dual Testing Approach

This feature requires both unit testing and property-based testing for comprehensive coverage:

**Unit Tests:**
- Specific examples demonstrating correct behavior
- Edge cases (boundary values, empty inputs, extreme values)
- Error conditions (invalid inputs, missing fields)
- Integration points between components
- API endpoint functionality

**Property-Based Tests:**
- Universal properties that hold for all inputs
- Comprehensive input coverage through randomization
- Determinism verification
- Statelessness verification
- Rule hierarchy enforcement

**Balance:** Avoid writing too many unit tests for scenarios that property tests already cover. Focus unit tests on specific examples and edge cases, while property tests handle broad input coverage.

### Property-Based Testing Configuration

**Library Selection:** Use `fast-check` for TypeScript property-based testing

**Configuration:**
- Minimum 100 iterations per property test (due to randomization)
- Seed-based reproducibility for failed tests
- Shrinking enabled to find minimal failing examples

**Test Tagging:**
Each property test must reference its design document property:
```typescript
// Feature: options-trading-engines, Property 1: Input validation completeness
test('entry engine validates all required fields', () => {
  fc.assert(
    fc.property(
      entryDecisionInputArbitrary(),
      (input) => {
        // Test implementation
      }
    ),
    { numRuns: 100 }
  );
});
```

### Test Data Generation

**Arbitraries (Generators) Needed:**

For Entry Decision Engine:
```typescript
// Generate valid entry decision inputs
const entryDecisionInputArbitrary = () => fc.record({
  symbol: fc.stringOf(fc.char().filter(c => /[A-Z]/.test(c)), { minLength: 1, maxLength: 5 }),
  timestamp: fc.integer({ min: Date.now() - 86400000, max: Date.now() }),
  direction: fc.constantFrom('CALL', 'PUT'),
  setupType: fc.constantFrom('SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS'),
  signal: fc.record({
    confidence: fc.integer({ min: 0, max: 100 }),
    pattern: fc.constantFrom('BREAKOUT', 'PULLBACK', 'REVERSAL', 'CONTINUATION'),
    timeframe: fc.constantFrom('1m', '5m', '15m', '1h', '4h', 'D')
  }),
  // ... other fields
});

// Generate inputs that trigger Tier 1 blocks
const tier1BlockingInputArbitrary = () => 
  entryDecisionInputArbitrary().map(input => ({
    ...input,
    signal: { ...input.signal, confidence: fc.integer({ min: 0, max: 30 }) }
  }));
```

For Strike Selection Engine:
```typescript
// Generate option contracts
const optionContractArbitrary = (setupType: SetupType) => fc.record({
  expiry: fc.date({ min: new Date(), max: new Date(Date.now() + 730 * 86400000) }),
  dte: fc.integer({ min: 1, max: 730 }),
  strike: fc.double({ min: 50, max: 500 }),
  bid: fc.double({ min: 0.01, max: 100 }),
  ask: fc.double({ min: 0.01, max: 100 }),
  // Ensure ask > bid
  // ... other fields
});

// Generate option chains with various characteristics
const optionChainArbitrary = () => fc.array(optionContractArbitrary(), { minLength: 10, maxLength: 100 });
```

For Exit Decision Engine:
```typescript
// Generate exit decision inputs with various P&L states
const exitDecisionInputArbitrary = () => fc.record({
  tradePosition: fc.record({
    id: fc.uuid(),
    symbol: fc.stringOf(fc.char().filter(c => /[A-Z]/.test(c)), { minLength: 1, maxLength: 5 }),
    direction: fc.constantFrom('CALL', 'PUT'),
    setupType: fc.constantFrom('SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS')
  }),
  // ... other fields
});

// Generate inputs at profit targets
const profitTargetInputArbitrary = (setupType: SetupType, targetPercent: number) =>
  exitDecisionInputArbitrary().map(input => ({
    ...input,
    // Adjust prices to hit target
  }));
```

### Unit Test Coverage

**Entry Decision Engine Unit Tests:**
- Test each Tier 1 rule individually with specific examples
- Test timing window edge cases (first/last 15 minutes)
- Test mode-specific entry instructions with boundary confidence values
- Test API endpoint with valid and invalid requests

**Strike Selection Engine Unit Tests:**
- Test DTE filtering at boundaries (e.g., DTE = 3, 14, 15 for SCALP)
- Test liquidity gates at exact thresholds
- Test delta filtering at range boundaries
- Test scoring with contracts that differ in only one dimension
- Test tie-breaking with identical scores
- Test NO_VALID_STRIKE response when all contracts filtered

**Exit Decision Engine Unit Tests:**
- Test each tier rule individually with specific examples
- Test profit ladder at exact percentages
- Test time stops at exact boundaries
- Test Greeks degradation at thresholds
- Test conservative action selection with specific rule combinations

### Integration Tests

**API Integration Tests:**
- Test POST /api/entry-decision with valid request → 200 response
- Test POST /api/strike-selection with valid request → 200 response
- Test POST /api/exit-decision with valid request → 200 response
- Test all endpoints with invalid requests → 400 responses
- Test all endpoints with malformed JSON → 400 responses

**Cross-Engine Integration:**
- Test entry → strike selection flow with approved entry
- Test strike selection → exit decision flow with selected contract
- Verify guardrails from strike selection are respected by exit engine

### Performance Testing

While not part of core correctness, basic performance benchmarks:
- Entry decision should complete in <50ms for typical inputs
- Strike selection should complete in <200ms for chains with 100 contracts
- Exit decision should complete in <50ms for typical inputs

### Test Organization

```
/tests/
  unit/
    entryEngine/
      tier1Rules.test.ts
      tier2Rules.test.ts
      entryInstructions.test.ts
      validation.test.ts
    strikeSelection/
      dteFilter.test.ts
      liquidityFilter.test.ts
      greeksFilter.test.ts
      scoring.test.ts
      tieBreaking.test.ts
    exitEngine/
      tier1Rules.test.ts
      tier2Rules.test.ts
      tier3Rules.test.ts
      tier4Rules.test.ts
      greeksAnalysis.test.ts
      conservativeAction.test.ts
  
  property/
    entryEngine.property.test.ts
    strikeSelection.property.test.ts
    exitEngine.property.test.ts
    crossEngine.property.test.ts
  
  integration/
    api.integration.test.ts
    crossEngine.integration.test.ts
  
  arbitraries/
    entryDecisionArbitraries.ts
    strikeSelectionArbitraries.ts
    exitDecisionArbitraries.ts
    commonArbitraries.ts
```

### Continuous Testing

- Run unit tests on every commit
- Run property tests on every commit (with reduced iterations for speed, full runs nightly)
- Run integration tests before merge to main
- Track test coverage (aim for >90% line coverage, 100% branch coverage for rule logic)

### Test Maintenance

- Update property tests when new rules are added
- Update arbitraries when input contracts change
- Keep test data generators in sync with validation schemas
- Document any test-specific assumptions or constraints
