# UI Data Quality Audit - Requirements

## 1. Overview

Perform a comprehensive data quality audit of the OptionAgents trading platform user interface to identify data issues, inconsistencies, missing values, and backend connection problems across all pages.

## 2. User Stories

### 2.1 As a QA Engineer
I need to audit all UI pages to identify which data is loading from the backend vs mock data, so that I can troubleshoot connection issues and ensure production readiness.

### 2.2 As a Platform Developer
I need to know which API endpoints are failing or returning incomplete data, so that I can prioritize backend fixes and ensure data consistency.

### 2.3 As a Product Manager
I need visibility into data quality issues across the platform, so that I can assess launch readiness and user experience quality.

## 3. Acceptance Criteria

### 3.1 Dashboard Page Audit
- **AC 3.1.1**: Document all metric values (Total P&L, Win Rate, Active Positions, Profit Factor) with actual values shown
- **AC 3.1.2**: Identify if metrics show real values or placeholders ("--", "N/A", "0")
- **AC 3.1.3**: Document performance chart data: timeframe selected, data points visible, trend direction
- **AC 3.1.4**: List all Recent Activity entries with symbol, status, time, and percentage
- **AC 3.1.5**: Identify data source (backend vs mock) from x-data-source header
- **AC 3.1.6**: Document API endpoint: `/api/dashboard/metrics` → Backend: `/dashboard`

### 3.2 Positioning Page Audit
- **AC 3.2.1**: Document currently selected symbol and active tab
- **AC 3.2.2**: Record SPY GEX Summary values (Total GEX, Call GEX, Put GEX)
- **AC 3.2.3**: Record Max Pain Analysis data (Strike price, Gamma Regime, Zero Gamma Level, Distance to Zero)
- **AC 3.2.4**: Identify any "--" placeholders or missing calculations
- **AC 3.2.5**: Note: This page uses MOCK DATA ONLY (no backend integration)
- **AC 3.2.6**: Document API endpoint: `/api/positioning/[symbol]` → Mock data only

### 3.3 Orders Page Audit
- **AC 3.3.1**: Document active tab and number of orders visible
- **AC 3.3.2**: For each order: Symbol, Type, Strike, Expiry, Qty, Price, Status, Time
- **AC 3.3.3**: Identify duplicate orders (same symbol, strike, expiry, price, time)
- **AC 3.3.4**: Identify orders missing critical data fields
- **AC 3.3.5**: Identify data source (backend vs mock)
- **AC 3.3.6**: Document API endpoint: `/api/orders` → Backend: `/orders`

### 3.4 History Page Audit
- **AC 3.4.1**: Document Total P&L value and change percentage
- **AC 3.4.2**: Document Win Rate percentage and change indicator
- **AC 3.4.3**: Document Profit Factor value and change indicator
- **AC 3.4.4**: Document Average Hold time
- **AC 3.4.5**: Count trades visible in Trade History Timeline
- **AC 3.4.6**: For each trade: Symbol, Type, Date, P&L amount, P&L percentage
- **AC 3.4.7**: Verify Win/Loss Mix chart percentages match individual trades
- **AC 3.4.8**: Verify Total P&L math matches sum of individual trade P&Ls
- **AC 3.4.9**: Identify data source (backend vs mock)
- **AC 3.4.10**: Document API endpoint: `/api/history/stats` → Backend: `/history/stats`

### 3.5 Monitoring Page Audit
- **AC 3.5.1**: Document selected view (Overview/Decision engines/Show all/Production only/Test only/Last X)
- **AC 3.5.2**: Document Webhooks (24h): total count, accepted count
- **AC 3.5.3**: Document Webhook Failures: count, invalid count
- **AC 3.5.4**: Document Duplicates: count and description
- **AC 3.5.5**: Document WebSocket: status (Online/Offline), enabled symbols count
- **AC 3.5.6**: For Recent Webhooks table: Time, Symbol, TF, Variant, Status, MS
- **AC 3.5.7**: For Recent Rejections table: Symbol, TF, Reason, Time
- **AC 3.5.8**: Identify patterns in failures (e.g., all invalid_payload, all market_closed)
- **AC 3.5.9**: Identify data source (backend vs mock)
- **AC 3.5.10**: Document API endpoint: `/api/monitoring/status` → Backend: `/monitoring/status`

### 3.6 Intel Console Page Audit
- **AC 3.6.1**: Document Trade Day status (YES/NO)
- **AC 3.6.2**: Document Symbol shown
- **AC 3.6.3**: Document Gamma Regime: direction and type
- **AC 3.6.4**: Document Zero Gamma Level value
- **AC 3.6.5**: Document Distance to Zero value in ATR
- **AC 3.6.6**: Document Expected Behavior description
- **AC 3.6.7**: Identify data source (backend vs mock)
- **AC 3.6.8**: Document API endpoint: `/api/intel/latest` → Backend: `/intel/latest`

### 3.7 Decision Engines Page Audit
- **AC 3.7.1**: Document Processing rate value
- **AC 3.7.2**: Document Success rate percentage
- **AC 3.7.3**: Document Average decision latency
- **AC 3.7.4**: Document Failures (24h) count and breakdown
- **AC 3.7.5**: For Decision Log: Time, Symbol, TF, Decision, Strike/Exp, Qty/Entry, Confidence, Outcome, MS, Engine
- **AC 3.7.6**: For Engine Comparison: Decisions count, Success rate, Avg latency, Queue depth for each engine
- **AC 3.7.7**: Identify if decisions show real values or all showing "Hold" with "--"
- **AC 3.7.8**: Document Processing Pipeline: Signals received, Decisions made, Orders placed, Queue depths, Stuck stage
- **AC 3.7.9**: Identify data source (backend vs mock)
- **AC 3.7.10**: Document API endpoint: Part of `/api/monitoring/status` → Backend: `/monitoring/status`

### 3.8 Summary Report
- **AC 3.8.1**: List pages/sections with complete, accurate data
- **AC 3.8.2**: List pages/sections with partial or missing data
- **AC 3.8.3**: List pages/sections with incorrect or suspicious data
- **AC 3.8.4**: Provide overall data quality score (0-100%)
- **AC 3.8.5**: Identify backend connection issues
- **AC 3.8.6**: Provide prioritized recommendations for fixes

## 4. Data Source Mapping

### 4.1 Backend-Integrated Pages
- **Dashboard**: `/api/dashboard/metrics` → Backend `/dashboard` (fallback to mock)
- **Orders**: `/api/orders` → Backend `/orders` (fallback to mock)
- **History**: `/api/history/stats` → Backend `/history/stats` (fallback to mock)
- **Monitoring**: `/api/monitoring/status` → Backend `/monitoring/status` (fallback to mock)
- **Intel Console**: `/api/intel/latest` → Backend `/intel/latest` (fallback to mock)

### 4.2 Mock-Only Pages
- **Positioning**: `/api/positioning/[symbol]` → Mock data only (NO backend integration)

## 5. Quality Indicators

### 5.1 Placeholder Values to Flag
- ❌ "--" (double dash)
- ❌ "N/A"
- ❌ "0" or "$0.00" (when unexpected)
- ❌ Empty strings or null values
- ❌ "undefined" or "null" as text

### 5.2 Suspicious Data Patterns
- ⚠️ Duplicate entries with identical timestamps
- ⚠️ Math inconsistencies (totals don't match sums)
- ⚠️ Impossible values (negative quantities, future dates in history)
- ⚠️ All decisions showing "Hold" with no variation
- ⚠️ All failures with same error type

### 5.3 Correct Data Indicators
- ✅ Real numeric values with appropriate precision
- ✅ Timestamps in correct format and logical sequence
- ✅ Status badges with appropriate colors
- ✅ Data source header showing "backend" or "mock"

### 5.4 Error States
- 🔴 Error messages visible on page
- 🔴 Failed API calls (check browser console)
- 🔴 Timeout errors
- 🔴 Authentication failures

## 6. Out of Scope

- Performance testing (load times, response times)
- UI/UX design review
- Accessibility testing
- Cross-browser compatibility
- Mobile responsiveness
- Security testing
- Code quality review

## 7. Assumptions

- User has valid authentication credentials
- Backend server is running (or expected to be running)
- Frontend is running in development or production mode
- Browser developer tools are available for inspection
- User can access all pages without permission restrictions

## 8. Dependencies

- Frontend application must be running
- Backend API may or may not be available (audit will document this)
- Valid user session/authentication token
- Browser with developer tools (Chrome, Firefox, Edge)

## 9. Success Metrics

- 100% of pages audited
- All data fields documented with actual values
- Data source identified for each page
- All placeholder values flagged
- All suspicious patterns identified
- Prioritized fix recommendations provided
- Overall data quality score calculated
