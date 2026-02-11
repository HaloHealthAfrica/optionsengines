# UI Data Quality Audit - Tasks

## 1. Setup and Preparation

- [ ] 1.1 Verify backend server is running (or document if unavailable)
- [ ] 1.2 Start frontend development server
- [ ] 1.3 Login with valid test credentials
- [ ] 1.4 Open browser developer tools (Network tab)
- [ ] 1.5 Create audit report template document

## 2. Dashboard Page Audit

- [ ] 2.1 Navigate to Dashboard page (/)
  - [ ] 2.1.1 Check x-data-source header value
  - [ ] 2.1.2 Document API endpoint and response status
  - [ ] 2.1.3 Record Total P&L value and delta
  - [ ] 2.1.4 Record Win Rate value and delta
  - [ ] 2.1.5 Record Active Positions count and delta
  - [ ] 2.1.6 Record Profit Factor value and delta
  - [ ] 2.1.7 Document performance chart timeframe and data points
  - [ ] 2.1.8 List all Recent Activity entries (symbol, action, time, pnl)
  - [ ] 2.1.9 Flag any placeholder values ("--", "N/A", "0")
  - [ ] 2.1.10 Calculate page quality score
  - [ ] 2.1.11 Document issues and recommendations

## 3. Positioning Page Audit

- [ ] 3.1 Navigate to Positioning page
  - [ ] 3.1.1 Note: This page uses MOCK DATA ONLY
  - [ ] 3.1.2 Document currently selected symbol
  - [ ] 3.1.3 Document active tab
  - [ ] 3.1.4 Record SPY GEX Summary (Total GEX, Call GEX, Put GEX)
  - [ ] 3.1.5 Record Max Pain Analysis (Strike, Gamma Regime, Zero Gamma Level, Distance to Zero)
  - [ ] 3.1.6 Record Options Flow Summary (Net Premium, Bullish %, Bearish %)
  - [ ] 3.1.7 Record Signal Correlation values
  - [ ] 3.1.8 Flag any "--" placeholders or missing calculations
  - [ ] 3.1.9 Calculate page quality score
  - [ ] 3.1.10 Document critical issue: No backend integration

## 4. Orders Page Audit

- [ ] 4.1 Navigate to Orders page
  - [ ] 4.1.1 Check x-data-source header value
  - [ ] 4.1.2 Document API endpoint and response status
  - [ ] 4.1.3 Document active tab (Active Orders/Filled Trades/Closed P&L)
  - [ ] 4.1.4 Count number of orders visible in current view
  - [ ] 4.1.5 For each order row, document: Symbol, Type, Strike, Expiry, Qty, Price, Status, Time
  - [ ] 4.1.6 Check for duplicate orders (same symbol, strike, expiry, price, time)
  - [ ] 4.1.7 Check for orders missing critical data fields
  - [ ] 4.1.8 Verify Risk Snapshot data (if visible)
  - [ ] 4.1.9 Test order detail modal (click on order)
  - [ ] 4.1.10 Calculate page quality score
  - [ ] 4.1.11 Document issues and recommendations

## 5. History Page Audit

- [ ] 5.1 Navigate to History page
  - [ ] 5.1.1 Check x-data-source header value
  - [ ] 5.1.2 Document API endpoint and response status
  - [ ] 5.1.3 Record Total P&L value and change percentage
  - [ ] 5.1.4 Record Win Rate percentage and change indicator
  - [ ] 5.1.5 Record Profit Factor value and change indicator
  - [ ] 5.1.6 Record Average Hold time
  - [ ] 5.1.7 Count trades visible in Trade History Timeline
  - [ ] 5.1.8 For each trade, document: Symbol, Type, Date, P&L amount, P&L percentage
  - [ ] 5.1.9 Record Win/Loss Mix chart percentages
  - [ ] 5.1.10 Verify Win/Loss percentages sum to 100%
  - [ ] 5.1.11 Verify Total P&L math matches sum of individual trade P&Ls
  - [ ] 5.1.12 Calculate page quality score
  - [ ] 5.1.13 Document issues and recommendations

## 6. Monitoring Page Audit (Overview)

- [ ] 6.1 Navigate to Monitoring page (Overview view)
  - [ ] 6.1.1 Check x-data-source header value
  - [ ] 6.1.2 Document API endpoint and response status
  - [ ] 6.1.3 Document selected view (Show all/Production only/Test only/Last X)
  - [ ] 6.1.4 Record Webhooks (24h): total count, accepted count
  - [ ] 6.1.5 Record Webhook Failures: count, invalid count
  - [ ] 6.1.6 Record Duplicates: count
  - [ ] 6.1.7 Record WebSocket: status (Online/Offline), enabled symbols count
  - [ ] 6.1.8 For Recent Webhooks table, document each row: Time, Symbol, TF, Variant, Status, MS
  - [ ] 6.1.9 Check for patterns in failures (e.g., all invalid_payload, all market_closed)
  - [ ] 6.1.10 Verify webhook summary totals match individual counts
  - [ ] 6.1.11 Calculate page quality score (Overview section)
  - [ ] 6.1.12 Document issues and recommendations

## 7. Monitoring Page Audit (Decision Engines)

- [ ] 7.1 Switch to Decision Engines view
  - [ ] 7.1.1 Record Processing rate value (per min, per hour)
  - [ ] 7.1.2 Record Success rate percentage
  - [ ] 7.1.3 Record Average decision latency (ms)
  - [ ] 7.1.4 Record Failures (24h) count
  - [ ] 7.1.5 Record Total decisions count
  - [ ] 7.1.6 For Decision Log table, document each row: Time, Symbol, TF, Decision, Strike/Exp, Qty/Entry, Confidence, Outcome, MS, Engine
  - [ ] 7.1.7 Check if decisions show real values or all showing "Hold" with "--"
  - [ ] 7.1.8 For Engine Comparison, document Engine A: Decisions, Success rate, Avg latency, Queue depth
  - [ ] 7.1.9 For Engine Comparison, document Engine B: Decisions, Success rate, Avg latency, Queue depth
  - [ ] 7.1.10 Document Agent Performance table (if visible)
  - [ ] 7.1.11 Record Processing Pipeline: Signals received, Decisions made, Orders placed, Queue depths, Stuck stage
  - [ ] 7.1.12 Verify pipeline consistency (signals ≥ decisions ≥ orders)
  - [ ] 7.1.13 Document Decision Breakdown (by symbol, decision, outcome, timeframe)
  - [ ] 7.1.14 Calculate page quality score (Decision Engines section)
  - [ ] 7.1.15 Document issues and recommendations

## 8. Intel Console Page Audit

- [ ] 8.1 Navigate to Intel Console page
  - [ ] 8.1.1 Check x-data-source header value
  - [ ] 8.1.2 Document API endpoint and response status
  - [ ] 8.1.3 Document Trade Day status (YES/NO)
  - [ ] 8.1.4 Document Symbol shown (e.g., SPY)
  - [ ] 8.1.5 Record Gamma Regime: direction and type
  - [ ] 8.1.6 Record Zero Gamma Level value
  - [ ] 8.1.7 Record Distance to Zero value in ATR
  - [ ] 8.1.8 Record Expected Behavior description
  - [ ] 8.1.9 Check for any "--" placeholders
  - [ ] 8.1.10 Verify allowTrading logic matches gamma data
  - [ ] 8.1.11 Calculate page quality score
  - [ ] 8.1.12 Document issues and recommendations

## 9. Cross-Page Validation

- [ ] 9.1 Verify data consistency across pages
  - [ ] 9.1.1 Compare Total P&L between Dashboard and History
  - [ ] 9.1.2 Compare Win Rate between Dashboard and History
  - [ ] 9.1.3 Compare Active Positions count between Dashboard and Orders
  - [ ] 9.1.4 Verify Recent Activity on Dashboard matches Orders/History
  - [ ] 9.1.5 Document any inconsistencies

## 10. Backend Connection Analysis

- [ ] 10.1 Analyze backend connectivity
  - [ ] 10.1.1 List all pages using backend data successfully
  - [ ] 10.1.2 List all pages falling back to mock data
  - [ ] 10.1.3 List all pages with connection errors
  - [ ] 10.1.4 Document backend API endpoints that are working
  - [ ] 10.1.5 Document backend API endpoints that are failing
  - [ ] 10.1.6 Check backend server logs (if accessible)
  - [ ] 10.1.7 Verify authentication token is valid
  - [ ] 10.1.8 Test backend endpoints directly (Postman/curl)

## 11. Issue Categorization and Prioritization

- [ ] 11.1 Categorize all identified issues
  - [ ] 11.1.1 List all P0 (Critical) issues
  - [ ] 11.1.2 List all P1 (High) issues
  - [ ] 11.1.3 List all P2 (Medium) issues
  - [ ] 11.1.4 List all P3 (Low) issues
  - [ ] 11.1.5 For each issue, document: Page, Impact, Root Cause, Recommendation, Effort

## 12. Quality Score Calculation

- [ ] 12.1 Calculate individual page scores
  - [ ] 12.1.1 Dashboard page score (Completeness + Accuracy + Consistency + Backend Integration)
  - [ ] 12.1.2 Positioning page score
  - [ ] 12.1.3 Orders page score
  - [ ] 12.1.4 History page score
  - [ ] 12.1.5 Monitoring Overview score
  - [ ] 12.1.6 Monitoring Decision Engines score
  - [ ] 12.1.7 Intel Console page score
- [ ] 12.2 Calculate overall platform quality score (average of all pages)
- [ ] 12.3 Assign quality rating (Excellent/Good/Fair/Poor/Critical)

## 13. Report Generation

- [ ] 13.1 Create Executive Summary
  - [ ] 13.1.1 Overall quality score and rating
  - [ ] 13.1.2 Key findings (top 5 issues)
  - [ ] 13.1.3 Backend connectivity status
  - [ ] 13.1.4 Launch readiness assessment
  - [ ] 13.1.5 Top 3 recommendations

- [ ] 13.2 Create Detailed Findings Section
  - [ ] 13.2.1 Dashboard page findings
  - [ ] 13.2.2 Positioning page findings
  - [ ] 13.2.3 Orders page findings
  - [ ] 13.2.4 History page findings
  - [ ] 13.2.5 Monitoring page findings
  - [ ] 13.2.6 Intel Console page findings

- [ ] 13.3 Create Data Source Mapping Section
  - [ ] 13.3.1 Table of all API routes and their backend endpoints
  - [ ] 13.3.2 Status of each endpoint (working/mock/error)
  - [ ] 13.3.3 Identify pages with no backend integration

- [ ] 13.4 Create Issues and Recommendations Section
  - [ ] 13.4.1 P0 issues with detailed recommendations
  - [ ] 13.4.2 P1 issues with detailed recommendations
  - [ ] 13.4.3 P2 issues with detailed recommendations
  - [ ] 13.4.4 P3 issues with detailed recommendations

- [ ] 13.5 Create Quality Metrics Section
  - [ ] 13.5.1 Quality score by page (bar chart or table)
  - [ ] 13.5.2 Issue count by priority (pie chart or table)
  - [ ] 13.5.3 Backend vs mock data usage (pie chart)
  - [ ] 13.5.4 Data completeness percentage by page

- [ ] 13.6 Create Appendix
  - [ ] 13.6.1 Screenshots of key issues
  - [ ] 13.6.2 Network request/response examples
  - [ ] 13.6.3 Sample data structures
  - [ ] 13.6.4 Testing methodology details

## 14. Property-Based Testing (Optional)

- [ ] 14.1 Write property tests for data validation
  - [ ] 14.1.1 Property 1: Data source consistency test
  - [ ] 14.1.2 Property 2: No placeholder values test
  - [ ] 14.1.3 Property 3: Math consistency test
  - [ ] 14.1.4 Property 4: No duplicate entries test
  - [ ] 14.1.5 Property 5: Valid data types test
  - [ ] 14.1.6 Property 6: Percentage values sum to 100 test
  - [ ] 14.1.7 Property 7: Timestamps in logical order test
- [ ] 14.2 Run all property tests
- [ ] 14.3 Document test results
- [ ] 14.4 Add test failures to issue list

## 15. Regression Testing (After Fixes)

- [ ] 15.1 Re-run audit after fixes are deployed
- [ ] 15.2 Verify P0 issues are resolved
- [ ] 15.3 Verify P1 issues are resolved
- [ ] 15.4 Check for new issues introduced
- [ ] 15.5 Recalculate quality scores
- [ ] 15.6 Update audit report with new findings
- [ ] 15.7 Document improvement percentage

## 16. Deliverables and Sign-off

- [ ] 16.1 Finalize audit report document
- [ ] 16.2 Create issue tickets in tracking system
- [ ] 16.3 Present findings to development team
- [ ] 16.4 Present findings to product/QA team
- [ ] 16.5 Get sign-off on priorities
- [ ] 16.6 Archive audit artifacts (screenshots, logs, data samples)
- [ ] 16.7 Schedule follow-up audit date
