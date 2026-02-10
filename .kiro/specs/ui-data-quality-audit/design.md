# UI Data Quality Audit - Design Document

## 1. Architecture Overview

This audit follows a systematic page-by-page inspection methodology to assess data quality across the OptionAgents trading platform UI.

### 1.1 Audit Approach
```
┌─────────────────────────────────────────────────────────────┐
│                    UI Data Quality Audit                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────┐
        │     For Each Page/Component:            │
        │  1. Inspect UI in browser               │
        │  2. Check x-data-source header          │
        │  3. Document all visible values         │
        │  4. Flag placeholders/issues            │
        │  5. Verify backend connection           │
        └─────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────┐
        │         Generate Audit Report           │
        │  • Data completeness by page            │
        │  • Backend vs mock data usage           │
        │  • Identified issues & patterns         │
        │  • Prioritized recommendations          │
        │  • Overall quality score                │
        └─────────────────────────────────────────┘
```

### 1.2 Data Flow Analysis
```
Frontend Component → API Route → Backend API Client → Backend Server
                                      ↓ (on error)
                                   Mock Data
```

## 2. Page-by-Page Audit Specifications

### 2.1 Dashboard Page (`/`)

#### 2.1.1 Data Sources
- **API Route**: `frontend/app/api/dashboard/metrics/route.js`
- **Backend Endpoint**: `/dashboard`
- **Fallback**: Mock data from `frontend/lib/mock-data.js`
- **Component**: `frontend/components/Dashboard.js`

#### 2.1.2 Data Points to Audit
```typescript
interface DashboardData {
  metrics: Array<{
    label: string;           // "Total P&L", "Win Rate", "Active Positions", "Profit Factor"
    value: string;           // Actual value or "--"
    delta: string;           // Change percentage or "--"
    trend: 'up' | 'down';    // Trend indicator
  }>;
  performance: Array<{
    name: string;            // Month name
    value: number;           // P&L value
  }>;
  recentActivity: Array<{
    symbol: string;          // Ticker symbol
    action: string;          // "Opened" | "Closed"
    time: string;            // Relative time
    pnl: string;             // Percentage with +/- sign
  }>;
}
```

#### 2.1.3 Quality Checks
- ✅ All 4 metrics have non-placeholder values
- ✅ Performance chart has 6 data points (Jan-Jun)
- ✅ Recent Activity shows 5 entries
- ✅ x-data-source header is "backend" (not "mock")
- ❌ Any metric showing "--" or "N/A"
- ❌ Empty performance array
- ❌ Missing recent activity entries

### 2.2 Positioning Page (`/positioning`)

#### 2.2.1 Data Sources
- **API Route**: `frontend/app/api/positioning/[symbol]/route.js`
- **Backend Endpoint**: NONE (mock data only)
- **Component**: `frontend/components/Positioning.js`

#### 2.2.2 Data Points to Audit
```typescript
interface PositioningData {
  symbol: string;
  gex: {
    total: string;           // e.g., "$2.4B"
    call: string;            // e.g., "$1.8B"
    put: string;             // e.g., "$600M"
  };
  gamma: {
    regime: 'LONG_GAMMA' | 'SHORT_GAMMA' | 'NEUTRAL';
    zeroGammaLevel: number;  // e.g., 445.2
    expectedBehavior: 'MEAN_REVERT' | 'EXPANSION';
    distanceATR: number;     // e.g., 0.35
  };
  optionsFlow: {
    premium: string;         // e.g., "$420M"
    bullish: number;         // Percentage
    bearish: number;         // Percentage
  };
  maxPain: {
    strike: string;          // e.g., "$445.00"
    note: string;
  };
  correlation: Array<{
    label: string;
    value: number;           // 0-1 range
    color: string;           // Tailwind class
  }>;
}
```

#### 2.2.3 Quality Checks
- ⚠️ **CRITICAL**: This page has NO backend integration
- ✅ All GEX values are formatted strings
- ✅ Gamma regime is one of three valid values
- ✅ Zero Gamma Level is a finite number
- ❌ Any "--" in gamma calculations
- ❌ Missing correlation data

### 2.3 Orders Page (`/orders`)

#### 2.3.1 Data Sources
- **API Route**: `frontend/app/api/orders/route.js`
- **Backend Endpoint**: `/orders`
- **Fallback**: Mock data from `frontend/lib/mock-data.js`
- **Component**: `frontend/components/Orders.js`

#### 2.3.2 Data Points to Audit
```typescript
interface OrdersData {
  orders: Array<Order>;      // Active orders
  trades: Array<Trade>;      // Filled trades
  positions: Array<Position>; // Closed positions
}

interface Order {
  id: string;
  symbol: string;
  type: 'Call' | 'Put';
  strike: number;
  expiry: string;            // Date string
  qty: number;
  price: number;
  status: 'pending' | 'filled' | 'cancelled';
  time: string;
  decision?: {               // Optional decision metadata
    engine: 'A' | 'B';
    source: string;
    bias?: string;
    confidence?: number;
    reasons?: string[];
  };
}

interface Position {
  id: string;
  symbol: string;
  type: 'Call' | 'Put';
  strike: number;
  expiry: string;
  qty: number;
  entry_price: number;
  realized_pnl: number;
  time: string;
}
```

#### 2.3.3 Quality Checks
- ✅ x-data-source header is "backend" (not "mock")
- ✅ All orders have complete fields (no null/undefined)
- ✅ Prices are formatted to 2 decimal places
- ✅ Timestamps are valid dates
- ❌ Duplicate orders (same symbol, strike, expiry, time)
- ❌ Missing critical fields (symbol, strike, qty)
- ❌ Invalid status values
- ❌ Negative quantities or prices

### 2.4 History Page (`/history`)

#### 2.4.1 Data Sources
- **API Route**: `frontend/app/api/history/stats/route.js`
- **Backend Endpoint**: `/history/stats`
- **Fallback**: Mock data from `frontend/lib/mock-data.js`
- **Component**: `frontend/components/History.js`

#### 2.4.2 Data Points to Audit
```typescript
interface HistoryData {
  stats: {
    totalPnl: string;        // e.g., "$12,450.82"
    winRate: string;         // e.g., "68.5%"
    profitFactor: string;    // e.g., "2.34"
    avgHold: string;         // e.g., "3.2 days"
  };
  timeline: Array<{
    symbol: string;
    type: 'Call' | 'Put';
    date: string;            // ISO date string
    pnl: string;             // e.g., "+8.5%"
    value: string;           // e.g., "$1,250"
  }>;
  distribution: Array<{
    name: 'Wins' | 'Losses';
    value: number;           // Percentage
  }>;
}
```

#### 2.4.3 Quality Checks
- ✅ x-data-source header is "backend" (not "mock")
- ✅ All 4 stats have non-placeholder values
- ✅ Timeline has at least 1 trade
- ✅ Win/Loss distribution sums to 100%
- ✅ Total P&L math matches sum of timeline values
- ❌ Any stat showing "--" or "N/A"
- ❌ Empty timeline array
- ❌ Distribution percentages don't sum to 100%
- ❌ Math inconsistencies in P&L calculations

### 2.5 Monitoring Page (`/monitoring`)

#### 2.5.1 Data Sources
- **API Route**: `frontend/app/api/monitoring/status/route.js`
- **Backend Endpoint**: `/monitoring/status`
- **Fallback**: Mock data from `frontend/lib/mock-data.js`
- **Component**: `frontend/components/Monitoring.js`

#### 2.5.2 Data Points to Audit
```typescript
interface MonitoringData {
  timestamp: string;
  webhooks: {
    recent: Array<{
      event_id: string;
      status: 'accepted' | 'duplicate' | 'invalid_signature' | 'invalid_payload' | 'error';
      symbol: string;
      direction: 'long' | 'short';
      timeframe: string;
      variant: 'A' | 'B';
      processing_time_ms: number;
      created_at: string;
      is_test?: boolean;
    }>;
    summary_24h: {
      total: number;
      accepted: number;
      duplicate: number;
      invalid_signature: number;
      invalid_payload: number;
      error: number;
    };
  };
  engines: {
    by_variant_24h: {
      A: number;
      B: number;
    };
  };
  websocket: {
    enabled: boolean;
    connected: boolean;
    subscribedSymbols: string[];
    lastQuoteAt: string | null;
  };
  providers: {
    circuit_breakers: Record<string, {
      state: 'closed' | 'open' | 'half-open';
      failures: number;
    }>;
    down: string[];
    rate_limits: Array<{
      provider: string;
      capacity: number;
      currentTokens: number;
      utilizationPercent: string;
      requestsAllowed: number;
      requestsBlocked: number;
    }>;
  };
  decision_engine: {
    overview: {
      decisions_per_min: number;
      decisions_per_hour: number;
      success_rate: number;
      failure_rate: number;
      avg_latency_ms: number;
      utilization_pct: number;
      failures_24h: number;
      total_decisions: number;
    };
    comparison: {
      A: EngineStats;
      B: EngineStats;
    };
    pipeline: {
      signals_received: number;
      decisions_made: number;
      orders_placed: number;
      queue_depth_a: number;
      queue_depth_b: number;
      stuck_stage: string;
    };
    breakdown: {
      by_symbol: Array<{ label: string; value: number }>;
      by_decision: Array<{ label: string; value: number }>;
      by_outcome: Array<{ label: string; value: number }>;
      by_timeframe: Array<{ label: string; value: number }>;
    };
    decision_log: Array<DecisionLogEntry>;
    agent_metrics: Array<AgentMetric>;
  };
}
```

#### 2.5.3 Quality Checks
- ✅ x-data-source header is "backend" (not "mock")
- ✅ Webhook summary totals match individual counts
- ✅ WebSocket status is boolean (not "--")
- ✅ Decision engine metrics are numeric (not "--")
- ✅ Recent webhooks array has entries
- ❌ All webhooks showing same status (pattern issue)
- ❌ All failures with same error type
- ❌ Decision log empty or all showing "Hold"
- ❌ Pipeline stuck_stage not "None"
- ❌ Provider circuit breakers all "open"

### 2.6 Intel Console Page (`/intel`)

#### 2.6.1 Data Sources
- **API Route**: `frontend/app/api/intel/latest/route.js`
- **Backend Endpoint**: `/intel/latest`
- **Fallback**: Mock data from `frontend/lib/mock-data.js`
- **Component**: `frontend/components/IntelConsole.js`

#### 2.6.2 Data Points to Audit
```typescript
interface IntelData {
  symbol: string;
  timestamp: string;
  allowTrading: boolean;
  message?: string;
  gamma: {
    regime: 'LONG_GAMMA' | 'SHORT_GAMMA' | 'NEUTRAL';
    zeroGammaLevel: number;
    distanceATR: number;
    expectedBehavior: 'MEAN_REVERT' | 'EXPANSION';
    noTradeDay: boolean;
  };
}
```

#### 2.6.3 Quality Checks
- ✅ x-data-source header is "backend" (not "mock")
- ✅ Trade Day status is boolean (YES/NO)
- ✅ Gamma regime is valid enum value
- ✅ Zero Gamma Level is finite number
- ✅ Distance to Zero is formatted with ATR unit
- ❌ Any "--" in gamma calculations
- ❌ allowTrading inconsistent with gamma data
- ❌ noTradeDay calculation incorrect

### 2.7 Decision Engines View (Monitoring Sub-page)

#### 2.7.1 Data Sources
- Same as Monitoring page (part of `/api/monitoring/status`)
- Accessed via view toggle in Monitoring component

#### 2.7.2 Data Points to Audit
- Processing rate (decisions/min, decisions/hour)
- Success rate percentage
- Average decision latency (ms)
- Failures (24h) count
- Decision Log table (10 columns)
- Engine Comparison (A vs B)
- Agent Performance table
- Processing Pipeline metrics
- Decision Breakdown (by symbol, decision, outcome, timeframe)

#### 2.7.3 Quality Checks
- ✅ All overview metrics are numeric (not "--")
- ✅ Decision log has entries with complete data
- ✅ Engine comparison shows both A and B
- ✅ Pipeline metrics are consistent (signals ≥ decisions ≥ orders)
- ❌ Decision log empty
- ❌ All decisions showing "Hold"
- ❌ Engine B has 0 decisions (volume imbalance)
- ❌ Agent metrics table empty
- ❌ Breakdown arrays empty

## 3. Audit Execution Plan

### 3.1 Prerequisites
1. Start backend server (if available)
2. Start frontend development server
3. Login with valid credentials
4. Open browser developer tools
5. Navigate to Network tab

### 3.2 Audit Steps (Per Page)

#### Step 1: Navigate to Page
- Open page in browser
- Wait for all data to load
- Note any error messages

#### Step 2: Inspect Network Requests
- Check Network tab for API calls
- Verify response status (200, 404, 500, etc.)
- Check `x-data-source` header value
- Review response payload structure

#### Step 3: Document Visible Data
- Record all metric values exactly as shown
- Note any placeholder values ("--", "N/A", "0")
- Count number of items in lists/tables
- Screenshot any error states

#### Step 4: Verify Data Quality
- Check for duplicates
- Verify math (totals, percentages)
- Validate date formats
- Check for null/undefined values

#### Step 5: Test Interactions
- Try filtering/sorting (if available)
- Test refresh button
- Switch tabs/views
- Verify real-time updates (if applicable)

### 3.3 Documentation Format

For each page, document:
```markdown
## [Page Name]

### Data Source
- API Route: [path]
- Backend Endpoint: [path] or "MOCK ONLY"
- x-data-source: [backend|mock|error]

### Metrics/Data Points
- [Field Name]: [Actual Value] ✅/❌/⚠️
- [Field Name]: [Actual Value] ✅/❌/⚠️

### Issues Found
- ❌ [Description of issue]
- ⚠️ [Description of warning]

### Quality Score
[0-100%] based on completeness and accuracy
```

## 4. Quality Scoring Methodology

### 4.1 Scoring Criteria

#### Completeness (40 points)
- All expected fields present: 40 points
- 75-99% fields present: 30 points
- 50-74% fields present: 20 points
- 25-49% fields present: 10 points
- <25% fields present: 0 points

#### Accuracy (30 points)
- No placeholders, all real data: 30 points
- 1-2 placeholders: 20 points
- 3-5 placeholders: 10 points
- >5 placeholders: 0 points

#### Consistency (20 points)
- No math errors, no duplicates: 20 points
- 1-2 minor issues: 15 points
- 3-5 issues: 10 points
- >5 issues: 0 points

#### Backend Integration (10 points)
- Using backend data: 10 points
- Using mock data (fallback): 5 points
- Error state: 0 points

### 4.2 Overall Platform Score
```
Platform Score = Average of all page scores
```

### 4.3 Quality Ratings
- 90-100%: Excellent - Production ready
- 75-89%: Good - Minor issues to address
- 60-74%: Fair - Significant issues present
- 40-59%: Poor - Major data quality problems
- 0-39%: Critical - Not usable

## 5. Issue Prioritization

### 5.1 Priority Levels

#### P0 - Critical (Fix Immediately)
- Backend connection completely failing
- All data showing placeholders
- Math errors causing incorrect totals
- Security issues (exposed sensitive data)

#### P1 - High (Fix Before Launch)
- Key metrics showing "--" or "N/A"
- Missing backend integration (Positioning page)
- Duplicate data entries
- Inconsistent data across pages

#### P2 - Medium (Fix Soon)
- Minor placeholder values in non-critical fields
- Formatting inconsistencies
- Missing optional fields
- Slow data loading

#### P3 - Low (Nice to Have)
- UI polish issues
- Minor text inconsistencies
- Optional features not implemented

### 5.2 Recommendation Format
```markdown
## Issue: [Brief Description]
- **Priority**: P0/P1/P2/P3
- **Page**: [Page Name]
- **Impact**: [Description of user impact]
- **Root Cause**: [Technical cause]
- **Recommendation**: [Specific fix]
- **Effort**: [Low/Medium/High]
```

## 6. Correctness Properties

### Property 1: Data Source Consistency
**Validates: Requirements 3.1.5, 3.3.5, 3.4.9, 3.5.9, 3.6.7**

For all pages with backend integration, the `x-data-source` header must accurately reflect the actual data source.

```typescript
property("Data source header matches actual source", () => {
  forAll(page in [Dashboard, Orders, History, Monitoring, Intel], () => {
    const response = fetch(page.apiRoute);
    const dataSource = response.headers.get('x-data-source');
    const hasBackendData = response.data !== mockData;
    
    return (dataSource === 'backend' && hasBackendData) ||
           (dataSource === 'mock' && !hasBackendData);
  });
});
```

### Property 2: No Placeholder Values in Production
**Validates: Requirements 3.1.2, 3.2.4, 3.4.1-3.4.4, 3.7.7**

When using backend data, no metric should display placeholder values.

```typescript
property("Backend data contains no placeholders", () => {
  forAll(page in [Dashboard, Orders, History, Monitoring, Intel], () => {
    const response = fetch(page.apiRoute);
    if (response.headers.get('x-data-source') === 'backend') {
      const placeholders = ['--', 'N/A', 'undefined', 'null'];
      const dataString = JSON.stringify(response.data);
      return !placeholders.some(p => dataString.includes(p));
    }
    return true; // Skip check for mock data
  });
});
```

### Property 3: Math Consistency
**Validates: Requirements 3.4.8, 3.5.2**

Totals and aggregates must match the sum of individual items.

```typescript
property("Totals match sum of individual items", () => {
  // History page: Total P&L matches sum of trades
  const historyData = fetch('/api/history/stats');
  const totalPnl = parseFloat(historyData.stats.totalPnl.replace(/[$,]/g, ''));
  const sumOfTrades = historyData.timeline.reduce((sum, trade) => {
    return sum + parseFloat(trade.value.replace(/[$,]/g, ''));
  }, 0);
  
  // Monitoring page: Webhook summary matches individual counts
  const monitoringData = fetch('/api/monitoring/status');
  const summary = monitoringData.webhooks.summary_24h;
  const calculatedTotal = summary.accepted + summary.duplicate + 
                          summary.invalid_signature + summary.invalid_payload + 
                          summary.error;
  
  return Math.abs(totalPnl - sumOfTrades) < 0.01 &&
         summary.total === calculatedTotal;
});
```

### Property 4: No Duplicate Entries
**Validates: Requirements 3.3.3**

No two orders/trades should have identical key fields.

```typescript
property("No duplicate orders with same key fields", () => {
  const ordersData = fetch('/api/orders');
  const allOrders = [...ordersData.orders, ...ordersData.trades, ...ordersData.positions];
  
  const keys = allOrders.map(order => 
    `${order.symbol}-${order.strike}-${order.expiry}-${order.time}`
  );
  
  const uniqueKeys = new Set(keys);
  return keys.length === uniqueKeys.size;
});
```

### Property 5: Valid Data Types
**Validates: All requirements**

All fields must have the correct data type.

```typescript
property("All fields have correct data types", () => {
  forAll(page in [Dashboard, Orders, History, Monitoring, Intel], () => {
    const response = fetch(page.apiRoute);
    const data = response.data;
    
    // Check numeric fields are numbers
    const numericFields = extractNumericFields(data);
    const allNumeric = numericFields.every(field => 
      typeof field === 'number' && !isNaN(field)
    );
    
    // Check date fields are valid dates
    const dateFields = extractDateFields(data);
    const allValidDates = dateFields.every(field => 
      !isNaN(new Date(field).getTime())
    );
    
    // Check enum fields have valid values
    const enumFields = extractEnumFields(data);
    const allValidEnums = enumFields.every(field => 
      field.value in field.allowedValues
    );
    
    return allNumeric && allValidDates && allValidEnums;
  });
});
```

### Property 6: Percentage Values Sum to 100
**Validates: Requirements 3.4.7**

Distribution percentages must sum to 100%.

```typescript
property("Distribution percentages sum to 100", () => {
  const historyData = fetch('/api/history/stats');
  const distribution = historyData.distribution;
  const sum = distribution.reduce((total, item) => total + item.value, 0);
  
  return Math.abs(sum - 100) < 0.01; // Allow for rounding errors
});
```

### Property 7: Timestamps in Logical Order
**Validates: Requirements 3.3.2, 3.4.6, 3.5.6**

Recent items should have timestamps in descending order (newest first).

```typescript
property("Timestamps are in descending order", () => {
  const monitoringData = fetch('/api/monitoring/status');
  const webhooks = monitoringData.webhooks.recent;
  
  for (let i = 0; i < webhooks.length - 1; i++) {
    const current = new Date(webhooks[i].created_at);
    const next = new Date(webhooks[i + 1].created_at);
    if (current < next) return false;
  }
  
  return true;
});
```

## 7. Testing Strategy

### 7.1 Manual Testing
- Execute audit steps for each page
- Document findings in structured format
- Take screenshots of issues
- Record network requests

### 7.2 Automated Validation
- Run property-based tests
- Validate API response schemas
- Check for common issues (placeholders, nulls)
- Generate automated quality score

### 7.3 Regression Testing
- Re-run audit after fixes
- Verify issues are resolved
- Ensure no new issues introduced
- Update quality score

## 8. Deliverables

### 8.1 Audit Report
- Executive summary
- Page-by-page findings
- Issue list with priorities
- Quality scores
- Recommendations

### 8.2 Issue Tracking
- Create tickets for each issue
- Assign priorities
- Link to audit report
- Track resolution status

### 8.3 Quality Dashboard
- Overall platform score
- Score by page
- Issue count by priority
- Trend over time (if repeated)

## 9. Success Criteria

- ✅ All 7 pages audited
- ✅ Data source identified for each page
- ✅ All data fields documented
- ✅ All issues flagged and prioritized
- ✅ Quality score calculated
- ✅ Recommendations provided
- ✅ Report delivered in structured format
